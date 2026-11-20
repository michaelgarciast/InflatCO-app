import * as z from 'zod';
import { hasSomeField } from '../common/schemas.js';

export const productFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(50),
  baseUnit: z.enum(['g', 'ml', 'und']),
  baseSize: z.number().positive().max(100_000),
});

export const listProductsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const patchProductSchema = productFieldsSchema
  .partial()
  .refine(hasSomeField, 'Debe enviar al menos un campo para actualizar');

export type PatchProductDto = z.infer<typeof patchProductSchema>;
