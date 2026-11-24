import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthenticationModule } from '@nestjs/authentication';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  S3Disk,
  StorageModule,
  type StorageModuleOptions,
} from '@nestjs/storage';
import {
  LogMailTransport,
  MailModule,
  ResendTransport,
  SmtpTransport,
} from '@nestjs/mail';
import { validateEnv } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health.controller.js';
import { UsersModule } from './users/users.module.js';
import { AuthModule } from './auth/auth.module.js';
import { StoresModule } from './stores/stores.module.js';
import { ProductsModule } from './products/products.module.js';
import { ReceiptsModule } from './receipts/receipts.module.js';
import { InsightsModule } from './insights/insights.module.js';
import { ProxySecretGuard } from './common/proxy-secret.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DbModule,
    // La cookie ya es httpOnly, Secure, SameSite=Lax y Path=/ por defecto.
    AuthenticationModule.forRoot({
      session: { cookieName: '__Host-session', absoluteTtl: '30d', idleTtl: 0 },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 5,
      },
    ]),
    MailModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const smtpUrl = config.get<string>('SMTP_URL');
        const apiKey = config.get<string>('RESEND_API_KEY');
        return {
          // Sin SMTP_URL ni API key (desarrollo) el correo —link incluido— sale en los logs.
          transport: smtpUrl
            ? new SmtpTransport({ url: smtpUrl })
            : apiKey
              ? new ResendTransport({ apiKey })
              : new LogMailTransport({ body: true }),
          from: config.getOrThrow<string>('EMAIL_FROM'),
        };
      },
    }),
    UsersModule,
    AuthModule,
    StoresModule,
    ProductsModule,
    ReceiptsModule,
    InsightsModule,
    StorageModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageModuleOptions => ({
        default: 'receipts',
        disks: {
          // Las credenciales las lee S3Disk de AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
          receipts: new S3Disk({
            endpoint: config.getOrThrow<string>('AWS_ENDPOINT_URL_S3'),
            region: config.getOrThrow<string>('AWS_REGION'),
            bucket: config.getOrThrow<string>('S3_BUCKET'),
            forcePathStyle: true,
          }),
        },
      }),
    }),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
    { provide: APP_GUARD, useClass: ProxySecretGuard },
  ],
})
export class AppModule {}
