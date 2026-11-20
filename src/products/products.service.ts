import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, ilike, inArray, ne, sql } from 'drizzle-orm';
import { products, type NewProduct } from '../db/schema.js';
import type { Db, Tx } from '../db/types.js';
import { escapeLike } from '../common/sql.js';
import type { PatchProductDto } from './products.schemas.js';

const productColumns = {
  id: products.id,
  name: products.name,
  category: products.category,
  baseUnit: products.baseUnit,
  baseSize: products.baseSize,
};

export type CatalogProduct = Awaited<
  ReturnType<ProductsService['findAll']>
>[number];

const sameName = (name: string) =>
  sql`lower(${products.name}) = lower(${name})`;

@Injectable()
export class ProductsService {
  constructor(@InjectDrizzle() private readonly db: Db) {}

  findAll(userId: string, q?: string) {
    return this.db
      .select(productColumns)
      .from(products)
      .where(
        and(
          eq(products.userId, userId),
          q ? ilike(products.name, `%${escapeLike(q)}%`) : undefined,
        ),
      )
      .orderBy(products.name);
  }

  async exists(userId: string, id: string) {
    const [product] = await this.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, id), eq(products.userId, userId)));
    return Boolean(product);
  }

  async update(userId: string, id: string, dto: PatchProductDto) {
    if (dto.name) {
      const [duplicate] = await this.db
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.userId, userId),
            sameName(dto.name),
            ne(products.id, id),
          ),
        );
      if (duplicate)
        throw new ConflictException('Ya existe otro producto con ese nombre');
    }

    const { baseSize, ...fields } = dto;
    const [updated] = await this.db
      .update(products)
      .set({
        ...fields,
        ...(baseSize !== undefined && { baseSize: String(baseSize) }),
      })
      .where(and(eq(products.id, id), eq(products.userId, userId)))
      .returning(productColumns);
    if (!updated) throw new NotFoundException('Producto no encontrado');
    return updated;
  }

  findByIds(tx: Tx, userId: string, ids: string[]) {
    if (!ids.length) return Promise.resolve([]);
    return tx
      .select(productColumns)
      .from(products)
      .where(and(eq(products.userId, userId), inArray(products.id, ids)));
  }

  // Si ya existe uno con el mismo nombre (sin importar mayúsculas) se reutiliza.
  async findOrCreate(tx: Tx, userId: string, product: NewProduct) {
    const [existing] = await tx
      .select(productColumns)
      .from(products)
      .where(and(eq(products.userId, userId), sameName(product.name)));
    if (existing) return existing;

    const [created] = await tx
      .insert(products)
      .values({ ...product, userId, baseSize: String(product.baseSize) })
      .returning(productColumns);
    return created;
  }
}
