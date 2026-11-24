import { PasswordHasher } from '@nestjs/authentication';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { eq } from 'drizzle-orm';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { users, sessions } from '../src/db/schema.js';
import { normalizeEmail } from '../src/common/email.js';

const email = process.argv[2] && normalizeEmail(process.argv[2]);

if (!email || !email.includes('@')) {
  console.error('Uso: bun run user:create <email>');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Error: DATABASE_URL no configurada en las variables de entorno.');
  process.exit(1);
}

let password = process.env.USER_PASSWORD;

if (!password) {
  const rl = createInterface({ input: stdin, output: stdout });
  password = await rl.question('Contraseña (mínimo 12 caracteres): ');
  rl.close();
}

if (!password || password.length < 12) {
  console.error('Error: La contraseña debe tener al menos 12 caracteres.');
  process.exit(1);
}

const db = drizzle(connectionString);
const hasher = new PasswordHasher();
const passwordHash = await hasher.hash(password);

const [existing] = await db.select().from(users).where(eq(users.email, email));

if (existing) {
  await db.update(users).set({ passwordHash }).where(eq(users.id, existing.id));
  await db.delete(sessions).where(eq(sessions.userId, existing.id));
  console.log(`Contraseña actualizada y sesiones cerradas para ${email}`);
} else {
  await db.insert(users).values({ email, passwordHash });
  console.log(`Usuario creado exitosamente: ${email}`);
}
