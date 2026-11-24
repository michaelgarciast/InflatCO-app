import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getDrizzleToken } from '@nestjs/drizzle';
import { InMemoryMailTransport, MailTransport } from '@nestjs/mail';
import { PasswordHasher } from '@nestjs/authentication';
import { eq } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { passwordResetTokens, users } from '../src/db/schema.js';
import type * as schema from '../src/db/schema.js';

describe('Password reset (e2e)', () => {
  let app: INestApplication<App>;
  let db: NeonDatabase<typeof schema>;
  let proxySecret: string;
  let userId: string;
  const mailbox = new InMemoryMailTransport();
  const testEmail = 'reset-test@example.com';
  const testPassword = 'ValidPassword123';
  const newPassword = 'NewValidPassword456';

  // IPs distintas por test: el throttler cuenta por email|IP aunque el body falle.
  const forgot = (body: object, ip: string) =>
    request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('x-proxy-secret', proxySecret)
      .set('x-client-ip', ip)
      .send(body);

  const reset = (body: object, ip: string) =>
    request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('x-proxy-secret', proxySecret)
      .set('x-client-ip', ip)
      .send(body);

  const signIn = (email: string, password: string, ip: string) =>
    request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('x-proxy-secret', proxySecret)
      .set('x-client-ip', ip)
      .send({ email, password });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailTransport)
      .useValue(mailbox)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    proxySecret = app.get(ConfigService).getOrThrow<string>('PROXY_SECRET');
    db = app.get<NeonDatabase<typeof schema>>(getDrizzleToken());

    const passwordHash = await new PasswordHasher().hash(testPassword);
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, testEmail));
    if (existing) {
      userId = existing.id;
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    } else {
      const [created] = await db
        .insert(users)
        .values({ email: testEmail, passwordHash })
        .returning({ id: users.id });
      userId = created.id;
    }
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.email, testEmail));
    await app.close();
  });

  beforeEach(() => mailbox.clear());

  it('forgot-password con correo desconocido -> 200 sin correo', async () => {
    await forgot({ email: 'nadie@example.com' }, '198.51.100.20').expect(200);
    mailbox.assertNotSent();
  });

  it('forgot-password con email inválido -> 400', async () => {
    await forgot({ email: 'no-es-email' }, '198.51.100.21').expect(400);
  });

  let resetUrl: URL;

  it('forgot-password OK -> 200 y correo con link /recuperar', async () => {
    await forgot({ email: testEmail }, '198.51.100.22').expect(200);
    const mail = mailbox.assertSent({ to: testEmail });
    resetUrl = mail.link('/recuperar');
    expect(resetUrl.searchParams.get('token')).toBeTruthy();
  });

  it('reset-password con token inválido -> 400', async () => {
    await reset(
      { token: 'token-que-no-existe', password: newPassword },
      '198.51.100.23',
    ).expect(400);
  });

  it('reset-password con contraseña corta -> 400', async () => {
    const token = resetUrl.searchParams.get('token');
    await reset({ token, password: 'short' }, '198.51.100.24').expect(400);
  });

  it('reset-password OK -> 200, cierra sesiones y la contraseña vieja falla', async () => {
    const login = await signIn(testEmail, testPassword, '198.51.100.25').expect(
      200,
    );
    const cookies = login.headers['set-cookie'];
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : cookies;

    const token = resetUrl.searchParams.get('token');
    await reset({ token, password: newPassword }, '198.51.100.26').expect(200);

    // La sesión que existía antes del reset quedó cerrada.
    await request(app.getHttpServer())
      .get('/me')
      .set('x-proxy-secret', proxySecret)
      .set('Cookie', cookieHeader)
      .expect(401);

    await signIn(testEmail, testPassword, '198.51.100.27').expect(401);
    await signIn(testEmail, newPassword, '198.51.100.28').expect(200);
  });

  it('el token no se puede reusar -> 400', async () => {
    const token = resetUrl.searchParams.get('token');
    await reset({ token, password: newPassword }, '198.51.100.29').expect(400);
  });

  it('token expirado -> 400', async () => {
    await forgot({ email: testEmail }, '198.51.100.30').expect(200);
    const mail = mailbox.assertSent({ to: testEmail });
    const token = mail.link('/recuperar').searchParams.get('token');

    await db
      .update(passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResetTokens.userId, userId));

    await reset({ token, password: newPassword }, '198.51.100.31').expect(400);
  });
});
