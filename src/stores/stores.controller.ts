import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import type { User } from '../users/users.service.js';
import { idSchema } from '../common/schemas.js';
import { StoresService } from './stores.service.js';
import {
  listStoresQuerySchema,
  patchStoreSchema,
  type ListStoresQuery,
  type PatchStoreDto,
} from './stores.schemas.js';

@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  findAll(
    @CurrentUser() user: User,
    @Query({ schema: listStoresQuerySchema }) query: ListStoresQuery,
  ) {
    return this.storesService.findAll(user.id, query.q);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: patchStoreSchema }) dto: PatchStoreDto,
  ) {
    return this.storesService.update(user.id, id, dto);
  }
}
