import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AiOutputError } from '@nestjs/ai';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Storage } from '@nestjs/storage';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { detectImageType, hashImage, type ImageType } from '../common/image.js';
import { receiptImages, receiptItems, receipts } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import { ProductsService } from '../products/products.service.js';
import { StoresService } from '../stores/stores.service.js';
import { ExtractionService } from './extraction.service.js';
import type { CreateReceiptBody, Extraction } from './receipts.schemas.js';

type Db = NeonDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type ExtractedItem = Extraction['items'][number];
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
          .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId)))
          .returning(receiptColumns);
      },
    );
    await this.deleteFiles(oldKeys);
    return result;
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
    return toResponse(saved, items);
  }

  private async findOwned(userId: string, receiptId: string) {
    const [receipt] = await this.db
      .select({ id: receipts.id, status: receipts.status })
      .from(receipts)
      .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId)));
    if (!receipt) throw new NotFoundException('Factura no encontrada');
    return receipt;
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
      items.map((item) => ({
        receiptId,
        // La IA podría inventar un id o copiar uno que no es del usuario.
        productId:
          item.matchedProductId && productIds.has(item.matchedProductId)
            ? item.matchedProductId
            : null,
        rawDescription: item.rawDescription,
        quantity: String(item.quantity),
        unit: item.unit,
        unitPrice: item.unitPrice,
        discount: item.discount,
        lineTotal: item.lineTotal,
      })),
    )
    .returning();
}

function toResponse(
  saved: {
    receipt: ReceiptRow;
    images: { id: string; position: number }[];
    items: (typeof receiptItems.$inferSelect)[];
  },
  extracted: ExtractedItem[],
) {
  if (saved.receipt.status === 'unreadable') {
    return {
      ...saved,
      message: 'No se pudo leer la foto: tómala de nuevo con buena iluminación',
    };
  }
  const linesTotal = saved.items.reduce((sum, item) => sum + item.lineTotal, 0);
  return {
    ...saved,
    // RETURNING de un INSERT multi-fila devuelve las filas en el orden de VALUES.
    items: saved.items.map((item, i) => ({
      ...item,
      suggestedProduct: extracted[i].suggestedProduct,
    })),
    ...(linesTotal !== saved.receipt.total && {
      warning: 'La suma de las líneas no coincide con el total de la factura',
    }),
  };
}
