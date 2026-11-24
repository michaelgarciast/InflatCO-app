import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiOutputError } from '@nestjs/ai';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Storage } from '@nestjs/storage';
import {
  and,
  count,
  desc,
  eq,
  exists,
  getTableColumns,
  gte,
  ilike,
  inArray,
  lte,
  max,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { detectImageType, hashImage, type ImageType } from '../common/image.js';
import { escapeLike } from '../common/sql.js';
import {
  products,
  receiptImages,
  receiptItems,
  receipts,
  stores,
} from '../db/schema.js';
import type { Db, Tx } from '../db/types.js';
import { ProductsService } from '../products/products.service.js';
import { StoresService } from '../stores/stores.service.js';
import { ExtractionService } from './extraction.service.js';
import type {
  CreateItemDto,
  CreateReceiptBody,
  Extraction,
  ListReceiptsQuery,
  PatchItemDto,
  PatchReceiptDto,
} from './receipts.schemas.js';
import { lineTotal, unitPriceBase } from './unit-price.js';

type ExtractedItem = Extraction['items'][number];
type Item = typeof receiptItems.$inferSelect;
type ReceiptFields = ReturnType<typeof parseExtraction>['fields'];

interface NewImage {
  buffer: Buffer;
  type: ImageType;
  hash: string;
  key: string;
  position: number;
}

// Sin ai_raw: es para depurar, no para el cliente.
const receiptColumns = {
  id: receipts.id,
  storeId: receipts.storeId,
  purchasedAt: receipts.purchasedAt,
  total: receipts.total,
  cufe: receipts.cufe,
  status: receipts.status,
  entryMode: receipts.entryMode,
  unreadableReason: receipts.unreadableReason,
  createdAt: receipts.createdAt,
};
type ReceiptRow = Pick<
  typeof receipts.$inferSelect,
  keyof typeof receiptColumns
>;

const storeColumns = { id: stores.id, name: stores.name, type: stores.type };

const ownedReceipt = (userId: string, id: string) =>
  and(eq(receipts.id, id), eq(receipts.userId, userId));

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly storage: Storage,
    private readonly extraction: ExtractionService,
    private readonly stores: StoresService,
    private readonly products: ProductsService,
  ) {}

  async create(
    userId: string,
    files: Express.Multer.File[] | undefined,
    body: CreateReceiptBody,
  ) {
    const images = this.readImages(userId, files);
    await this.assertNotRegistered(userId, images);
    const storeId = await this.resolveStore(userId, body);

    return this.extractAndSave(userId, images, (tx, fields) =>
      tx
        .insert(receipts)
        .values({ userId, storeId, entryMode: 'ai', ...fields })
        .returning(receiptColumns),
    );
  }

  async retryImages(
    userId: string,
    receiptId: string,
    files: Express.Multer.File[] | undefined,
  ) {
    const current = await this.findOwned(userId, receiptId);
    if (current.status !== 'unreadable') {
      throw new ConflictException(
        'Solo se pueden cambiar las fotos de una factura ilegible',
      );
    }
    const images = this.readImages(userId, files);
    await this.assertNotRegistered(userId, images, receiptId);

    let oldKeys: string[] = [];
    const result = await this.extractAndSave(
      userId,
      images,
      async (tx, fields) => {
        const old = await tx
          .delete(receiptImages)
          .where(eq(receiptImages.receiptId, receiptId))
          .returning({ key: receiptImages.imageKey });
        oldKeys = old.map((img) => img.key);
        return tx
          .update(receipts)
          .set(fields)
          .where(ownedReceipt(userId, receiptId))
          .returning(receiptColumns);
      },
    );
    await this.deleteFiles(oldKeys);
    return result;
  }

  async findAll(userId: string, { page, limit, ...f }: ListReceiptsQuery) {
    const withItem = (condition: SQL | undefined) =>
      exists(
        this.db
          .select({ id: receiptItems.id })
          .from(receiptItems)
          .leftJoin(products, eq(products.id, receiptItems.productId))
          .where(and(eq(receiptItems.receiptId, receipts.id), condition)),
      );
    const q = f.q && `%${escapeLike(f.q)}%`;
    const where = and(
      eq(receipts.userId, userId),
      f.storeType ? eq(stores.type, f.storeType) : undefined,
      f.storeId ? eq(receipts.storeId, f.storeId) : undefined,
      f.from ? gte(receipts.purchasedAt, f.from) : undefined,
      f.to ? lte(receipts.purchasedAt, f.to) : undefined,
      q
        ? or(
            ilike(stores.name, q),
            withItem(
              or(
                ilike(products.name, q),
                ilike(receiptItems.rawDescription, q),
              ),
            ),
          )
        : undefined,
      f.category
        ? withItem(ilike(products.category, escapeLike(f.category)))
        : undefined,
    );

    const [data, [{ count: total }]] = await Promise.all([
      this.db
        .select({ ...receiptColumns, store: storeColumns })
        .from(receipts)
        .innerJoin(stores, eq(stores.id, receipts.storeId))
        .where(where)
        .orderBy(
          sql`${receipts.purchasedAt} desc nulls last`,
          desc(receipts.createdAt),
        )
        .limit(limit)
        .offset((page - 1) * limit),
      this.db
        .select({ count: count() })
        .from(receipts)
        .innerJoin(stores, eq(stores.id, receipts.storeId))
        .where(where),
    ]);
    return { data, page, limit, total };
  }

  async findOne(userId: string, id: string) {
    const [row] = await this.db
      .select({ ...receiptColumns, store: storeColumns })
      .from(receipts)
      .innerJoin(stores, eq(stores.id, receipts.storeId))
      .where(ownedReceipt(userId, id));
    if (!row) throw new NotFoundException('Factura no encontrada');
    const { store, ...receipt } = row;

    const [items, images] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(receiptItems),
          product: {
            id: products.id,
            name: products.name,
            category: products.category,
            baseUnit: products.baseUnit,
            baseSize: products.baseSize,
          },
        })
        .from(receiptItems)
        .leftJoin(products, eq(products.id, receiptItems.productId))
        .where(eq(receiptItems.receiptId, id))
        .orderBy(receiptItems.position, receiptItems.id),
      this.db
        .select({ id: receiptImages.id, position: receiptImages.position })
        .from(receiptImages)
        .where(eq(receiptImages.receiptId, id))
        .orderBy(receiptImages.position),
    ]);
    return { receipt, store, images, items, ...totalWarning(receipt, items) };
  }

  async update(userId: string, id: string, dto: PatchReceiptDto) {
    await this.findDraft(userId, id);
    const [updated] = await this.db
      .update(receipts)
      .set(dto)
      .where(ownedReceipt(userId, id))
      .returning(receiptColumns);
    return updated;
  }

  async updateItem(
    userId: string,
    receiptId: string,
    itemId: string,
    dto: PatchItemDto,
  ) {
    await this.findDraft(userId, receiptId);
    const [item] = await this.db
      .select()
      .from(receiptItems)
      .where(
        and(eq(receiptItems.id, itemId), eq(receiptItems.receiptId, receiptId)),
      );
    if (!item) throw new NotFoundException('Ítem no encontrado');
    if (dto.productId) await this.assertProduct(userId, dto.productId);

    const { description, quantity, productId, product, ...fields } = dto;
    const priceChanged =
      quantity !== undefined ||
      dto.unitPrice !== undefined ||
      dto.discount !== undefined;
    const [updated] = await this.db
      .update(receiptItems)
      .set({
        ...fields,
        ...(description !== undefined && { rawDescription: description }),
        ...(quantity !== undefined && { quantity: String(quantity) }),
        ...(priceChanged && {
          lineTotal: checkedLineTotal({
            quantity: quantity ?? Number(item.quantity),
            unitPrice: dto.unitPrice ?? item.unitPrice,
            discount: dto.discount ?? item.discount,
          }),
        }),
        ...(productId && { productId, newProduct: null }),
        ...(product && { productId: null, newProduct: product }),
      })
      .where(eq(receiptItems.id, itemId))
      .returning();
    return updated;
  }

  async startManual(userId: string, id: string) {
    const receipt = await this.findOwned(userId, id);
    if (receipt.status !== 'unreadable') {
      throw new ConflictException(
        'Solo se puede registrar a mano una factura cuya foto no se pudo leer',
      );
    }
    const [updated] = await this.db
      .update(receipts)
      .set({ status: 'draft', entryMode: 'manual' })
      .where(ownedReceipt(userId, id))
      .returning(receiptColumns);
    return updated;
  }

  async addItem(userId: string, receiptId: string, dto: CreateItemDto) {
    const receipt = await this.findDraft(userId, receiptId);
    if (receipt.entryMode !== 'manual') {
      throw new ConflictException(
        'Solo se pueden agregar productos a mano si la foto no se pudo leer',
      );
    }
    if (dto.productId) await this.assertProduct(userId, dto.productId);

    const [{ last }] = await this.db
      .select({ last: max(receiptItems.position) })
      .from(receiptItems)
      .where(eq(receiptItems.receiptId, receiptId));
    const [item] = await this.db
      .insert(receiptItems)
      .values({
        receiptId,
        position: (last ?? 0) + 1,
        rawDescription: dto.description,
        quantity: String(dto.quantity),
        unit: dto.unit,
        unitPrice: dto.unitPrice,
        discount: dto.discount,
        lineTotal: checkedLineTotal(dto),
        productId: dto.productId ?? null,
        newProduct: dto.product ?? null,
        // Los escribió el usuario: no hay nada que revisar.
        confirmed: true,
      })
      .returning();
    return item;
  }

  async confirm(userId: string, id: string) {
    const receipt = await this.findDraft(userId, id);
    const items = await this.db
      .select()
      .from(receiptItems)
      .where(eq(receiptItems.receiptId, id));
    const problem = confirmProblem(receipt, items);
    if (problem) throw new UnprocessableEntityException(problem);

    await this.db.transaction(async (tx) => {
      const ids = items.flatMap((item) => item.productId ?? []);
      const known = new Map(
        (await this.products.findByIds(tx, userId, ids)).map((p) => [p.id, p]),
      );
      for (const item of items) {
        const product = item.productId
          ? known.get(item.productId)
          : item.newProduct &&
            (await this.products.findOrCreate(tx, userId, item.newProduct));
        if (!product) {
          throw new UnprocessableEntityException(
            `"${item.rawDescription}" no tiene un producto asociado`,
          );
        }
        const base = unitPriceBase(item, product);
        if (!base) {
          throw new UnprocessableEntityException(
            `La unidad de "${item.rawDescription}" (${item.unit}) no es compatible con la del producto (${product.baseUnit})`,
          );
        }
        await tx
          .update(receiptItems)
          .set({ productId: product.id, newProduct: null, unitPriceBase: base })
          .where(eq(receiptItems.id, item.id));
      }
      await tx
        .update(receipts)
        .set({ status: 'confirmed' })
        .where(ownedReceipt(userId, id));
    });
    return this.findOne(userId, id);
  }

  async reopen(userId: string, id: string) {
    const receipt = await this.findOwned(userId, id);
    if (receipt.status !== 'confirmed') {
      throw new ConflictException(
        'Solo se puede reabrir una factura confirmada',
      );
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(receipts)
        .set({ status: 'draft' })
        .where(ownedReceipt(userId, id));
      await tx
        .update(receiptItems)
        .set({ confirmed: false })
        .where(eq(receiptItems.receiptId, id));
    });
    return this.findOne(userId, id);
  }

  async remove(userId: string, id: string) {
    const receipt = await this.findOwned(userId, id);
    if (receipt.status === 'confirmed') {
      throw new ConflictException(
        'Una factura confirmada no se puede borrar: reábrela primero',
      );
    }
    const images = await this.db
      .select({ key: receiptImages.imageKey })
      .from(receiptImages)
      .where(eq(receiptImages.receiptId, id));
    // Ítems e imágenes se borran en cascada.
    await this.db.delete(receipts).where(ownedReceipt(userId, id));
    await this.deleteFiles(images.map((img) => img.key));
  }

  async getImages(userId: string, receiptId: string) {
    await this.findOwned(userId, receiptId);
    const images = await this.db
      .select({
        id: receiptImages.id,
        position: receiptImages.position,
        key: receiptImages.imageKey,
      })
      .from(receiptImages)
      .where(
        and(
          eq(receiptImages.receiptId, receiptId),
          eq(receiptImages.userId, userId),
        ),
      )
      .orderBy(receiptImages.position);

    const disk = this.storage.disk();
    return Promise.all(
      images.map(async ({ id, position, key }) => ({
        id,
        position,
        url: await disk.signedUrl(key, {
          expiresIn: '5m',
          disposition: 'inline',
        }),
      })),
    );
  }

  private async extractAndSave(
    userId: string,
    images: NewImage[],
    saveReceipt: (tx: Tx, fields: ReceiptFields) => Promise<ReceiptRow[]>,
  ) {
    const { extraction, productIds } = await this.storeAndExtract(
      userId,
      images,
    );
    const { fields, items } = parseExtraction(extraction);
    if (fields.cufe) await this.assertCufeFree(userId, fields.cufe, images);

    let saved;
    try {
      saved = await this.db.transaction(async (tx) => {
        const [receipt] = await saveReceipt(tx, fields);
        return {
          receipt,
          images: await insertImages(tx, userId, receipt.id, images),
          items: await insertItems(tx, receipt.id, items, productIds),
        };
      });
    } catch (error) {
      await this.deleteFiles(images.map((img) => img.key));
      throw error;
    }

    if (fields.status === 'draft' && extraction.nit) {
      await this.stores.setNitIfMissing(
        userId,
        saved.receipt.storeId,
        extraction.nit,
      );
    }
    return toResponse(saved);
  }

  private async findOwned(userId: string, receiptId: string) {
    const [receipt] = await this.db
      .select({
        id: receipts.id,
        status: receipts.status,
        entryMode: receipts.entryMode,
        purchasedAt: receipts.purchasedAt,
        total: receipts.total,
      })
      .from(receipts)
      .where(ownedReceipt(userId, receiptId));
    if (!receipt) throw new NotFoundException('Factura no encontrada');
    return receipt;
  }

  private async findDraft(userId: string, receiptId: string) {
    const receipt = await this.findOwned(userId, receiptId);
    if (receipt.status === 'confirmed') {
      throw new ConflictException(
        'La factura ya está confirmada: reábrela para editarla',
      );
    }
    if (receipt.status === 'unreadable') {
      throw new ConflictException(
        'La factura es ilegible: toma la foto de nuevo o regístrala a mano',
      );
    }
    return receipt;
  }

  private async assertProduct(userId: string, productId: string) {
    if (!(await this.products.exists(userId, productId))) {
      throw new NotFoundException('Producto no encontrado');
    }
  }

  private readImages(
    userId: string,
    files: Express.Multer.File[] | undefined,
  ): NewImage[] {
    if (!files?.length || files.length > 2) {
      throw new BadRequestException(
        'Sube 1 o 2 fotos de la factura en el campo images',
      );
    }
    const images = files.map((file, i) => {
      const type = detectImageType(file.buffer);
      if (!type)
        throw new BadRequestException(
          'Formato no permitido: usa JPEG, PNG, WebP o HEIC',
        );
      return {
        buffer: file.buffer,
        type,
        hash: hashImage(file.buffer),
        key: `users/${userId}/receipts/${randomUUID()}`,
        position: i + 1,
      };
    });
    if (images.length === 2 && images[0].hash === images[1].hash) {
      throw new BadRequestException('Las dos fotos son la misma imagen');
    }
    return images;
  }

  private async assertNotRegistered(
    userId: string,
    images: NewImage[],
    exceptReceiptId?: string,
  ) {
    const [duplicate] = await this.db
      .select({ id: receiptImages.id })
      .from(receiptImages)
      .where(
        and(
          eq(receiptImages.userId, userId),
          inArray(
            receiptImages.imageHash,
            images.map((img) => img.hash),
          ),
          exceptReceiptId
            ? ne(receiptImages.receiptId, exceptReceiptId)
            : undefined,
        ),
      )
      .limit(1);
    if (duplicate)
      throw new ConflictException(
        'Esta foto ya está registrada en otra factura',
      );
  }

  private async assertCufeFree(
    userId: string,
    cufe: string,
    images: NewImage[],
  ) {
    const [duplicate] = await this.db
      .select({ id: receipts.id })
      .from(receipts)
      .where(and(eq(receipts.userId, userId), eq(receipts.cufe, cufe)));
    if (duplicate) {
      await this.deleteFiles(images.map((img) => img.key));
      throw new ConflictException('Esta factura ya está registrada');
    }
  }

  private async resolveStore(userId: string, body: CreateReceiptBody) {
    if ('storeId' in body) {
      const store = await this.stores.findById(userId, body.storeId);
      if (!store) throw new NotFoundException('Tienda no encontrada');
      return store.id;
    }
    return (
      await this.stores.findOrCreate(userId, body.storeName, body.storeType)
    ).id;
  }

  // Subida y extracción en paralelo; si cualquiera falla se borran las fotos para que no
  // queden huérfanas ni bloqueen el hash al reintentar.
  private async storeAndExtract(userId: string, images: NewImage[]) {
    const disk = this.storage.disk();
    const catalog = await this.products.findAll(userId);
    const [upload, extraction] = await Promise.allSettled([
      Promise.all(
        images.map((img) =>
          disk.put(img.key, img.buffer, { contentType: img.type }),
        ),
      ),
      this.extraction.extract(images, catalog),
    ]);

    if (upload.status === 'fulfilled' && extraction.status === 'fulfilled') {
      return {
        extraction: extraction.value,
        productIds: new Set(catalog.map((p) => p.id)),
      };
    }

    await this.deleteFiles(images.map((img) => img.key));
    if (upload.status === 'rejected') {
      this.logger.error(
        `No se pudieron subir las fotos: ${errorMessage(upload.reason)}`,
      );
      throw new BadGatewayException(
        'No se pudieron guardar las fotos, intenta de nuevo',
      );
    }
    this.logger.error(
      `Falló la extracción con IA: ${extractionError((extraction as PromiseRejectedResult).reason)}`,
    );
    throw new BadGatewayException(
      'No se pudo leer la factura, intenta de nuevo',
    );
  }

  private async deleteFiles(keys: string[]) {
    if (!keys.length) return;
    try {
      await this.storage.disk().delete(keys);
    } catch (error) {
      this.logger.warn(
        `No se pudieron borrar ${keys.length} fotos: ${errorMessage(error)}`,
      );
    }
  }
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// El mensaje de AiOutputError trae la factura completa; al log solo va qué campo no validó.
const extractionError = (error: unknown) =>
  error instanceof AiOutputError
    ? `salida fuera del schema: ${error.message.split('Error message: ').at(1) ?? 'sin detalle'}`
    : errorMessage(error);

// La IA puede decir "legible" sin haber sacado nada útil: sin ítems o sin total, se pide otra foto.
function parseExtraction(extraction: Extraction) {
  const missing = !extraction.items.length
    ? 'no_es_factura'
    : extraction.total === null
      ? 'cortada'
      : null;
  if (!extraction.readable || missing) {
    return {
      fields: {
        status: 'unreadable' as const,
        unreadableReason: extraction.readable
          ? missing
          : (extraction.unreadableReason ?? 'borrosa'),
        purchasedAt: null,
        total: null,
        cufe: null,
        aiRaw: extraction,
      },
      items: [],
    };
  }
  return {
    fields: {
      status: 'draft' as const,
      unreadableReason: null,
      purchasedAt: extraction.purchasedAt,
      total: extraction.total,
      cufe: extraction.cufe || null,
      aiRaw: extraction,
    },
    items: extraction.items,
  };
}

function insertImages(
  tx: Tx,
  userId: string,
  receiptId: string,
  images: NewImage[],
) {
  return tx
    .insert(receiptImages)
    .values(
      images.map((img) => ({
        userId,
        receiptId,
        position: img.position,
        imageKey: img.key,
        imageHash: img.hash,
      })),
    )
    .returning({ id: receiptImages.id, position: receiptImages.position });
}

async function insertItems(
  tx: Tx,
  receiptId: string,
  items: ExtractedItem[],
  productIds: Set<string>,
) {
  if (!items.length) return [];
  return tx
    .insert(receiptItems)
    .values(
      items.map((item, i) => {
        // La IA podría inventar un id o copiar uno que no es del usuario.
        const productId =
          item.matchedProductId && productIds.has(item.matchedProductId)
            ? item.matchedProductId
            : null;
        return {
          receiptId,
          position: i + 1,
          productId,
          newProduct: productId ? null : item.suggestedProduct,
          rawDescription: item.rawDescription,
          quantity: String(item.quantity),
          unit: item.unit,
          unitPrice: item.unitPrice,
          discount: item.discount,
          lineTotal: item.lineTotal,
        };
      }),
    )
    .returning();
}

function toResponse(saved: {
  receipt: ReceiptRow;
  images: { id: string; position: number }[];
  items: Item[];
}) {
  if (saved.receipt.status === 'unreadable') {
    return {
      ...saved,
      message: 'No se pudo leer la foto: tómala de nuevo con buena iluminación',
    };
  }
  return { ...saved, ...totalWarning(saved.receipt, saved.items) };
}

function totalWarning(
  receipt: { total: number | null },
  items: { lineTotal: number }[],
) {
  const linesTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  return items.length && linesTotal !== receipt.total
    ? {
        warning: 'La suma de las líneas no coincide con el total de la factura',
      }
    : {};
}

function checkedLineTotal(item: Parameters<typeof lineTotal>[0]) {
  const total = lineTotal(item);
  if (total < 0) {
    throw new BadRequestException(
      'El descuento no puede ser mayor que el valor de la línea',
    );
  }
  return total;
}

function confirmProblem(
  receipt: { purchasedAt: string | null; total: number | null },
  items: Item[],
) {
  if (!receipt.purchasedAt || receipt.total === null) {
    return 'Falta la fecha o el total de la factura';
  }
  if (!items.length) return 'La factura no tiene productos';
  const pending = items.filter((item) => !item.confirmed).length;
  if (pending) return `Faltan ${pending} productos por confirmar`;
  const unmatched = items.filter(
    (item) => !item.productId && !item.newProduct,
  ).length;
  if (unmatched) {
    return `${unmatched} productos no tienen asociado un producto del catálogo ni uno nuevo`;
  }
  return null;
}
