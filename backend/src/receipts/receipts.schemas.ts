import * as z from 'zod';
import { hasSomeField, storeTypeSchema } from '../common/schemas.js';
import { todayInBogota } from '../common/dates.js';
import { productFieldsSchema } from '../products/products.schemas.js';

export const createReceiptBodySchema = z.union([
  z.object({ storeId: z.uuid() }),
  z.object({
    storeName: z.string().trim().min(1).max(100),
    storeType: storeTypeSchema,
  }),
]);

export type CreateReceiptBody = z.infer<typeof createReceiptBodySchema>;

// Límites para la salida de la IA: una foto puede traer texto que intente manipularla.
const MAX_LINE_COP = 20_000_000;
const MAX_TOTAL_COP = 100_000_000;
const cop = (max: number) => z.number().int().nonnegative().max(max);

const notFuture = (date: string) => date <= todayInBogota();
const FUTURE_DATE = 'La fecha de la factura no puede ser futura';

export const listReceiptsQuerySchema = z.object({
  storeType: storeTypeSchema.optional(),
  storeId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(50).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListReceiptsQuery = z.infer<typeof listReceiptsQuerySchema>;

// Mass assignment: solo lo editable. Zod descarta status, cufe, aiRaw, id y demás claves.
export const patchReceiptSchema = z
  .object({
    purchasedAt: z.iso.date().refine(notFuture, FUTURE_DATE).optional(),
    total: z.number().int().positive().max(MAX_TOTAL_COP).optional(),
  })
  .refine(hasSomeField, 'Debe enviar al menos un campo para actualizar');

export type PatchReceiptDto = z.infer<typeof patchReceiptSchema>;

const itemFields = {
  description: z.string().trim().min(1).max(200),
  // numeric(10,3): se redondea aquí para que line_total salga de la misma cantidad que se guarda.
  quantity: z
    .number()
    .min(0.001)
    .max(1000)
    .transform((q) => Math.round(q * 1000) / 1000),
  unit: z.enum(['kg', 'g', 'l', 'ml', 'und']),
  unitPrice: cop(MAX_LINE_COP),
  discount: cop(MAX_LINE_COP),
  productId: z.uuid(),
  product: productFieldsSchema,
};

const notBothProducts = [
  (data: { productId?: string; product?: object }) =>
    !(data.productId && data.product),
  'Envía productId o product, no ambos',
] as const;

export const createItemSchema = z
  .object({
    ...itemFields,
    discount: itemFields.discount.default(0),
    productId: itemFields.productId.optional(),
    product: itemFields.product.optional(),
  })
  .refine(...notBothProducts)
  .refine(
    (data) => data.productId || data.product,
    'Envía productId o product',
  );

export type CreateItemDto = z.infer<typeof createItemSchema>;

export const patchItemSchema = z
  .object({ ...itemFields, confirmed: z.boolean() })
  .partial()
  .refine(...notBothProducts)
  .refine(hasSomeField, 'Debe enviar al menos un campo para actualizar');

export type PatchItemDto = z.infer<typeof patchItemSchema>;

export const unreadableReasons = [
  'borrosa',
  'oscura',
  'cortada',
  'reflejo',
  'no_es_factura',
] as const;

const extractedItemSchema = z.object({
  rawDescription: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('Texto de la línea tal como aparece'),
  quantity: z
    .number()
    .positive()
    .max(1000)
    .describe('Cantidad; decimales para peso, ej. 1.25'),
  unit: z.enum(['kg', 'g', 'l', 'ml', 'und']),
  unitPrice: cop(MAX_LINE_COP).describe('Precio unitario en COP'),
  discount: cop(MAX_LINE_COP).describe(
    'Descuento de la línea en COP, 0 si no tiene',
  ),
  lineTotal: cop(MAX_LINE_COP).describe('Total de la línea en COP'),
  matchedProductId: z
    .string()
    .max(64)
    .nullable()
    .describe('ID exacto de un producto del catálogo del usuario, o null'),
  suggestedProduct: z
    .object({
      name: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .describe('Nombre limpio, ej. "Leche entera"'),
      category: z.string().trim().min(1).max(50),
      baseUnit: z.enum(['g', 'ml', 'und']),
      baseSize: z
        .number()
        .positive()
        .max(100_000)
        .describe('Tamaño en la unidad base, ej. 1100'),
    })
    .nullable()
    .describe('Solo si no coincide con ningún producto del catálogo'),
});

export const extractionSchema = z.object({
  readable: z.boolean(),
  unreadableReason: z
    .enum(unreadableReasons)
    .nullable()
    .describe('Motivo si readable es false'),
  purchasedAt: z.iso
    .date()
    .nullable()
    // Gemini ya no recibe format: date; si devuelve otro formato queda null y el usuario la corrige.
    .catch(null)
    // Una fecha futura es salida manipulada y se rechaza, no se anula.
    .refine((date) => !date || notFuture(date), FUTURE_DATE)
    .describe('Fecha de compra, YYYY-MM-DD'),
  total: z
    .number()
    .int()
    .positive()
    .max(MAX_TOTAL_COP)
    .nullable()
    .describe('Total en COP'),
  nit: z
    .string()
    .trim()
    .max(30)
    .nullable()
    .describe('NIT de la tienda, o null'),
  cufe: z
    .string()
    .trim()
    .max(256)
    .nullable()
    .describe('CUFE de la factura electrónica, o null'),
  items: z.array(extractedItemSchema).max(200),
});

export type Extraction = z.infer<typeof extractionSchema>;

// Gemini convierte cotas numéricas (min/max, maxItems) y formatos complejos en estados de
// decodificación y rechaza el schema ("too many states"). Este va sin ellas; las cotas de
// seguridad se aplican después con extractionSchema.parse().
const geminiItemSchema = z.object({
  rawDescription: z.string().describe('Texto de la línea tal como aparece'),
  quantity: z.number().describe('Cantidad; decimales para peso, ej. 1.25'),
  unit: z.enum(['kg', 'g', 'l', 'ml', 'und']),
  unitPrice: z.number().describe('Precio unitario en COP'),
  discount: z.number().describe('Descuento de la línea en COP, 0 si no tiene'),
  lineTotal: z.number().describe('Total de la línea en COP'),
  matchedProductId: z
    .string()
    .nullable()
    .describe('ID exacto de un producto del catálogo del usuario, o null'),
  suggestedProduct: z
    .object({
      name: z.string().describe('Nombre limpio, ej. "Leche entera"'),
      category: z.string(),
      baseUnit: z.enum(['g', 'ml', 'und']),
      baseSize: z.number().describe('Tamaño en la unidad base, ej. 1100'),
    })
    .nullable()
    .describe('Solo si no coincide con ningún producto del catálogo'),
});

export const geminiExtractionSchema = z.object({
  readable: z.boolean(),
  unreadableReason: z
    .enum(unreadableReasons)
    .nullable()
    .describe('Motivo si readable es false'),
  purchasedAt: z.string().nullable().describe('Fecha de compra, YYYY-MM-DD'),
  total: z.number().nullable().describe('Total en COP'),
  nit: z.string().nullable().describe('NIT de la tienda, o null'),
  cufe: z
    .string()
    .nullable()
    .describe('CUFE de la factura electrónica, o null'),
  items: z.array(geminiItemSchema),
});
