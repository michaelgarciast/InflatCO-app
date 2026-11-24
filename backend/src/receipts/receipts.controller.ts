import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '@nestjs/authentication';
import type { User } from '../users/users.service.js';
import { idSchema } from '../common/schemas.js';
import { ReceiptsService } from './receipts.service.js';
import {
  createItemSchema,
  createReceiptBodySchema,
  listReceiptsQuerySchema,
  patchItemSchema,
  patchReceiptSchema,
  type CreateItemDto,
  type CreateReceiptBody,
  type ListReceiptsQuery,
  type PatchItemDto,
  type PatchReceiptDto,
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

  @Get()
  findAll(
    @CurrentUser() user: User,
    @Query({ schema: listReceiptsQuerySchema }) query: ListReceiptsQuery,
  ) {
    return this.receiptsService.findAll(user.id, query);
  }

  @Post()
  @receiptImages()
  create(
    @CurrentUser() user: User,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body({ schema: createReceiptBodySchema }) body: CreateReceiptBody,
  ) {
    return this.receiptsService.create(user.id, files, body);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
  ) {
    return this.receiptsService.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: patchReceiptSchema }) dto: PatchReceiptDto,
  ) {
    return this.receiptsService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
  ) {
    return this.receiptsService.remove(user.id, id);
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

  @Post(':id/manual')
  @HttpCode(200)
  startManual(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
  ) {
    return this.receiptsService.startManual(user.id, id);
  }

  @Post(':id/items')
  addItem(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: createItemSchema }) dto: CreateItemDto,
  ) {
    return this.receiptsService.addItem(user.id, id, dto);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
    @Param('itemId', { schema: idSchema }) itemId: string,
    @Body({ schema: patchItemSchema }) dto: PatchItemDto,
  ) {
    return this.receiptsService.updateItem(user.id, id, itemId, dto);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
  ) {
    return this.receiptsService.confirm(user.id, id);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
  ) {
    return this.receiptsService.reopen(user.id, id);
  }
}
