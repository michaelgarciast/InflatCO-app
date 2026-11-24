import * as z from 'zod';

// NEON_* y DATABASE_URL_UNPOOLED las escribe `neon env pull`; no las usa la app.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_ENDPOINT_URL_S3: z.url(),
  AWS_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  PROXY_SECRET: z.string().min(32),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
  // Sin RESEND_API_KEY los correos se loguean en vez de enviarse (desarrollo).
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default('InflatCO <onboarding@resend.dev>'),
  // Base del frontend para el link de recuperación de contraseña.
  FRONTEND_URL: z.url().default('http://localhost:5173'),
  AI_MODEL: z.string().default('gemini-3.5-flash-lite'),
});

export function validateEnv(config: Record<string, unknown>) {
  return envSchema.parse(config);
}
