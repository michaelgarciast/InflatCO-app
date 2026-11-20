import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '@nestjs/authentication';
import type { User } from '../users/users.service.js';
import { idSchema } from '../common/schemas.js';
import { ReceiptsService } from './receipts.service.js';
import {
  createReceiptBodySchema,
  type CreateReceiptBody,
} from './receipts.schemas.js';

// Una 3.ª foto o un archivo > 10 MB los corta multer antes de leerlos completos (400 / 413).
const receiptImages = () =>
  UseInterceptors(
    FilesInterceptor('images', 2, {
      limits: {
        files: 2,
        fileSize: 10 * 1024 * 1024,
        fields: 5,
        fieldSize: 1024,
        parts: 7,
      },
    }),
  );

@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Post()
  @receiptImages()
  create(
    @CurrentUser() user: User,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body({ schema: createReceiptBodySchema }) body: CreateReceiptBody,
  ) {
    return this.receiptsService.create(user.id, files, body);
  }

  @Put(':id/images')
  @receiptImages()
  retryImages(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    return this.receiptsService.retryImages(user.id, id, files);
  }

  @Get(':id/images')
  getImages(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
  ) {
    return this.receiptsService.getImages(user.id, id);
  }
}
