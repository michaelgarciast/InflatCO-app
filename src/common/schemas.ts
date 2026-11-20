import * as z from 'zod';

// Un id que no es UUID haría fallar la consulta en Postgres (500) en vez de responder 400.
export const idSchema = z.uuid();

export const storeTypeSchema = z.enum(['cadena', 'plaza', 'barrio']);
