import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm';
import { escapeLike } from '../common/sql.js';
import { products, receiptItems, receipts, stores } from '../db/schema.js';
import type { Db } from '../db/types.js';
import { productColumns } from '../products/products.service.js';
import type { InsightsFilters, SpendingQuery } from './insights.schemas.js';
import { priceChange } from './price-change.js';

const storeColumns = { id: stores.id, name: stores.name, type: stores.type };

// numeric(12,4) llega como string; aquí se devuelve como número para comparar y graficar.
const toPrice = (value: string) => Math.round(Number(value) * 10_000) / 10_000;

function filters(f: Partial<InsightsFilters>) {
  const q = f.q && `%${escapeLike(f.q)}%`;
  return and(
    f.storeType ? eq(stores.type, f.storeType) : undefined,
    f.storeId ? eq(receipts.storeId, f.storeId) : undefined,
    f.from ? gte(receipts.purchasedAt, f.from) : undefined,
    f.to ? lte(receipts.purchasedAt, f.to) : undefined,
    q ? or(ilike(products.name, q), ilike(stores.name, q)) : undefined,
    f.category ? ilike(products.category, escapeLike(f.category)) : undefined,
  );
}

@Injectable()
export class InsightsService {
  constructor(@InjectDrizzle() private readonly db: Db) {}

  async comparison(userId: string, receiptId: string) {
    const [receipt] = await this.db
      .select({
        id: receipts.id,
        status: receipts.status,
        purchasedAt: receipts.purchasedAt,
      })
      .from(receipts)
      .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId)));
    if (!receipt) throw new NotFoundException('Factura no encontrada');
    if (receipt.status !== 'confirmed') {
      throw new ConflictException(
        'Solo se puede comparar una factura confirmada',
      );
    }

    const current = this.purchases(userId, eq(receipts.id, receiptId));
    const currentPrices = await this.db
      .select({ unitPriceBase: current.unitPriceBase, product: productColumns })
      .from(current)
      .innerJoin(products, eq(products.id, current.productId))
      .orderBy(asc(products.name));

    // Factura anterior = fecha de compra menor; el mismo día, la que se subió antes.
    const before = this.purchases(
      userId,
      and(
        inArray(
          products.id,
          currentPrices.map((p) => p.product.id),
        ),
        sql`(${receipts.purchasedAt}, ${receipts.createdAt}) < (select r.purchased_at, r.created_at from receipts r where r.id = ${receiptId})`,
      ),
    );
    const previous = currentPrices.length
      ? await this.db
          .selectDistinctOn([before.productId], {
            productId: before.productId,
            receiptId: before.receiptId,
            purchasedAt: before.purchasedAt,
            unitPriceBase: before.unitPriceBase,
            store: storeColumns,
          })
          .from(before)
          .innerJoin(stores, eq(stores.id, before.storeId))
          .orderBy(
            before.productId,
            desc(before.purchasedAt),
            desc(before.createdAt),
          )
      : [];
    const previousByProduct = new Map(previous.map((p) => [p.productId, p]));

    const items = currentPrices.map(({ product, unitPriceBase }) => {
      const prev = previousByProduct.get(product.id);
      const currentPrice = toPrice(unitPriceBase);
      const previousPrice = prev ? toPrice(prev.unitPriceBase) : null;
      return {
        product,
        unitPriceBase: currentPrice,
        previous: prev
          ? {
              receiptId: prev.receiptId,
              purchasedAt: prev.purchasedAt,
              store: prev.store,
              unitPriceBase: previousPrice,
            }
          : null,
        ...priceChange(previousPrice, currentPrice),
      };
    });
    const summary = { subio: 0, bajo: 0, igual: 0, nuevo: 0 };
    for (const item of items) summary[item.trend]++;
    return { receiptId, purchasedAt: receipt.purchasedAt, summary, items };
  }

  async priceHistory(
    userId: string,
    productId: string,
    f: Partial<InsightsFilters>,
  ) {
    const [product] = await this.db
      .select(productColumns)
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)));
    if (!product) throw new NotFoundException('Producto no encontrado');

    const history = this.purchases(
      userId,
      and(eq(products.id, productId), filters(f)),
    );
    const rows = await this.db
      .select({
        receiptId: history.receiptId,
        purchasedAt: history.purchasedAt,
        unitPriceBase: history.unitPriceBase,
        store: storeColumns,
      })
      .from(history)
      .innerJoin(stores, eq(stores.id, history.storeId))
      .orderBy(asc(history.purchasedAt), asc(history.createdAt));

    let previous: number | null = null;
    const data = rows.map((row) => {
      const unitPriceBase = toPrice(row.unitPriceBase);
      const change = priceChange(previous, unitPriceBase);
      previous = unitPriceBase;
      return { ...row, unitPriceBase, ...change };
    });
    return { product, data };
  }

  async cheapest(userId: string, f: InsightsFilters) {
    const p = this.purchases(userId, filters(f));
    const latestPerStore = await this.db
      .selectDistinctOn([p.productId, p.storeId], {
        unitPriceBase: p.unitPriceBase,
        purchasedAt: p.purchasedAt,
        store: storeColumns,
        product: productColumns,
      })
      .from(p)
      .innerJoin(stores, eq(stores.id, p.storeId))
      .innerJoin(products, eq(products.id, p.productId))
      .orderBy(p.productId, p.storeId, desc(p.purchasedAt), desc(p.createdAt));

    const byProduct = new Map<string, typeof latestPerStore>();
    for (const row of latestPerStore) {
      byProduct.set(row.product.id, [
        ...(byProduct.get(row.product.id) ?? []),
        row,
      ]);
    }

    return [...byProduct.values()]
      .map((rows) => {
        const prices = rows
          .map(({ store, unitPriceBase, purchasedAt }) => ({
            store,
            unitPriceBase: toPrice(unitPriceBase),
            purchasedAt,
          }))
          .sort((a, b) => a.unitPriceBase - b.unitPriceBase);
        return {
          product: rows[0].product,
          cheapest: prices[0],
          // Ya ordenados por precio: el primero de cada tipo es el más barato de ese tipo.
          byStoreType: prices.filter(
            (price, i) =>
              prices.findIndex((p) => p.store.type === price.store.type) === i,
          ),
        };
      })
      .sort((a, b) => a.product.name.localeCompare(b.product.name, 'es'));
  }

  async spending(userId: string, { groupBy, category, ...f }: SpendingQuery) {
    const key =
      groupBy === 'month'
        ? sql<string>`to_char(${receipts.purchasedAt}, 'YYYY-MM')`
        : sql<string>`${stores.type}`;
    const where = and(
      eq(receipts.userId, userId),
      eq(receipts.status, 'confirmed'),
      filters(f),
    );

    // Con categoría se suman solo sus líneas; sin ella, el total de cada factura.
    const rows = category
      ? await this.db
          .select({
            key,
            total: sum(receiptItems.lineTotal).mapWith(Number),
            receipts: sql<number>`count(distinct ${receipts.id})`.mapWith(
              Number,
            ),
          })
          .from(receiptItems)
          .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
          .innerJoin(stores, eq(stores.id, receipts.storeId))
          .innerJoin(products, eq(products.id, receiptItems.productId))
          .where(and(where, filters({ category })))
          .groupBy(key)
          .orderBy(key)
      : await this.db
          .select({
            key,
            total: sum(receipts.total).mapWith(Number),
            receipts: count(),
          })
          .from(receipts)
          .innerJoin(stores, eq(stores.id, receipts.storeId))
          .where(where)
          .groupBy(key)
          .orderBy(key);

    return {
      groupBy,
      total: rows.reduce((acc, row) => acc + row.total, 0),
      data: rows,
    };
  }

  // Precio por unidad base de cada producto en cada factura confirmada del usuario
  // (promedio si el producto sale en varias líneas de la misma factura).
  private purchases(userId: string, where: SQL | undefined) {
    return this.db
      .select({
        productId: sql<string>`${products.id}`.as('product_id'),
        receiptId: sql<string>`${receipts.id}`.as('receipt_id'),
        storeId: receipts.storeId,
        purchasedAt: receipts.purchasedAt,
        createdAt: receipts.createdAt,
        unitPriceBase: sql<string>`avg(${receiptItems.unitPriceBase})`.as(
          'unit_price_base',
        ),
      })
      .from(receiptItems)
      .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
      .innerJoin(stores, eq(stores.id, receipts.storeId))
      .innerJoin(products, eq(products.id, receiptItems.productId))
      .where(
        and(
          eq(receipts.userId, userId),
          eq(receipts.status, 'confirmed'),
          where,
        ),
      )
      .groupBy(products.id, receipts.id)
      .as('purchases');
  }
}
