import * as z from 'zod';
import { listReceiptsQuerySchema } from '../receipts/receipts.schemas.js';

const filtersSchema = listReceiptsQuerySchema.omit({ page: true, limit: true });

export type InsightsFilters = z.infer<typeof filtersSchema>;

export const cheapestQuerySchema = filtersSchema;

export const priceHistoryQuerySchema = filtersSchema.pick({
  storeType: true,
  storeId: true,
  from: true,
  to: true,
});

// Sin q: un texto que coincida con la tienda sumaría la factura entera y uno que coincida
// con un producto solo esa línea. category sí: suma las líneas de esa categoría.
export const spendingQuerySchema = filtersSchema.omit({ q: true }).extend({
  groupBy: z.enum(['month', 'storeType']).default('month'),
});

export type SpendingQuery = z.infer<typeof spendingQuerySchema>;
