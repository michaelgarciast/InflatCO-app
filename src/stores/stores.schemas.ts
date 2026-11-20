import * as z from 'zod';
import { storeTypeSchema } from '../common/schemas.js';

export const listStoresQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});

export type ListStoresQuery = z.infer<typeof listStoresQuerySchema>;

export const patchStoreSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    type: storeTypeSchema.optional(),
    nit: z
      .string()
      .trim()
      .max(30)
      .transform((nit) => nit || null)
      .nullable()
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar',
  });

export type PatchStoreDto = z.infer<typeof patchStoreSchema>;
