import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getDrizzleToken } from '@nestjs/drizzle';
import { PasswordHasher } from '@nestjs/authentication';
import { eq } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { users } from '../src/db/schema.js';
import type * as schema from '../src/db/schema.js';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let proxySecret: string;
  const testEmail = 'phase1-test@example.com';
  const testPassword = 'ValidPassword123';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const config = app.get(ConfigService);
    proxySecret = config.getOrThrow<string>('PROXY_SECRET');

    const db = app.get<NeonDatabase<typeof schema>>(getDrizzleToken());
    const hasher = new PasswordHasher();
    const passwordHash = await hasher.hash(testPassword);

    const [existing] = await db.select().from(users).where(eq(users.email, testEmail));
    if (existing) {
      await db.update(users).set({ passwordHash }).where(eq(users.id, existing.id));
    } else {
      await db.insert(users).values({ email: testEmail, passwordHash });
    }
  });

  afterAll(async () => {
    const db = app.get<NeonDatabase<typeof schema>>(getDrizzleToken());
    await db.delete(users).where(eq(users.email, testEmail));
    await app.close();
  });

  // Sobre una ruta @Public: sin el guard de proxy respondería 200, no 401 por falta de sesión.
  it('sin X-Proxy-Secret -> 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: testEmail, password: testPassword })
      .expect(401);
  });

  it('con X-Proxy-Secret inválido -> 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('x-proxy-secret', 'invalid-secret-that-does-not-match')
      .send({ email: testEmail, password: testPassword })
      .expect(401);
  });

  it('sin cookie -> 401 en ruta protegida', async () => {
    await request(app.getHttpServer())
      .get('/me')
      .set('x-proxy-secret', proxySecret)
      .expect(401);
  });

  it('contraseña mala -> 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('x-proxy-secret', proxySecret)
      .send({ email: testEmail, password: 'wrong-password' })
      .expect(401);
  });

  let sessionCookie: string;

  it('login OK -> 200 y emite cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('x-proxy-secret', proxySecret)
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : cookies;
    expect(cookieHeader).toContain('__Host-session=');
    sessionCookie = cookieHeader;
  });

  it('/me con sesión válida -> 200 y datos del usuario', async () => {
    const res = await request(app.getHttpServer())
      .get('/me')
      .set('x-proxy-secret', proxySecret)
      .set('Cookie', sessionCookie)
      .expect(200);

    expect(res.body.email).toBe(testEmail);
    expect(res.body.id).toBeDefined();
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('sign-out con sesión -> 204 y revoca sesión', async () => {
    await request(app.getHttpServer())
      .post('/auth/sign-out')
      .set('x-proxy-secret', proxySecret)
      .set('Cookie', sessionCookie)
      .expect(204);

    // Intentar /me con la misma sesión ya cerrada debe fallar
    await request(app.getHttpServer())
      .get('/me')
      .set('x-proxy-secret', proxySecret)
      .set('Cookie', sessionCookie)
      .expect(401);
  });

  it('sign-out sin cookie -> 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/sign-out')
      .set('x-proxy-secret', proxySecret)
      .expect(401);
  });

  it('6.º intento de login -> 429', async () => {
    const throttleEmail = 'throttle-test@example.com';
    const clientIp = '198.51.100.42';

    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/sign-in')
        .set('x-proxy-secret', proxySecret)
        .set('x-client-ip', clientIp)
        .send({ email: throttleEmail, password: 'wrong' })
        .expect(401);
    }

    // 6.º intento debe recibir 429
    await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('x-proxy-secret', proxySecret)
      .set('x-client-ip', clientIp)
      .send({ email: throttleEmail, password: 'wrong' })
      .expect(429);
  });
});
