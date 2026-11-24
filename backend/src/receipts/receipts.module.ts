import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiModule } from '@nestjs/ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { StoresModule } from '../stores/stores.module.js';
import { ProductsModule } from '../products/products.module.js';
import { ReceiptsController } from './receipts.controller.js';
import { ReceiptsService } from './receipts.service.js';
import { ExtractionService } from './extraction.service.js';

@Module({
  imports: [
    StoresModule,
    ProductsModule,
    AiModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const google = createGoogleGenerativeAI({
          apiKey: config.getOrThrow<string>('GOOGLE_GENERATIVE_AI_API_KEY'),
        });
        return {
          models: { default: google(config.getOrThrow<string>('AI_MODEL')) },
          // Con los valores por defecto (60 s y 3 intentos) el request podría pasar los 100 s de Cloudflare.
          defaults: { timeout: '40s', retry: { attempts: 2 } },
        };
      },
    }),
  ],
  controllers: [ReceiptsController],
  providers: [ReceiptsService, ExtractionService],
})
export class ReceiptsModule {}
