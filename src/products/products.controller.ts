import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import type { User } from '../users/users.service.js';
import { idSchema } from '../common/schemas.js';
import { ProductsService } from './products.service.js';
import {
  listProductsQuerySchema,
  patchProductSchema,
  type ListProductsQuery,
  type PatchProductDto,
} from './products.schemas.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(
    @CurrentUser() user: User,
    @Query({ schema: listProductsQuerySchema }) query: ListProductsQuery,
  ) {
    return this.productsService.findAll(user.id, query.q);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: patchProductSchema }) dto: PatchProductDto,
  ) {
    return this.productsService.update(user.id, id, dto);
  }
}
