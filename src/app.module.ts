import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3Disk, StorageModule, type StorageModuleOptions } from '@nestjs/storage';
import { validateEnv } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DbModule,
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
})
export class AppModule {}
