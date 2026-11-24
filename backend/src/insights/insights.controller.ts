import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import type { User } from '../users/users.service.js';
import { idSchema } from '../common/schemas.js';
import { InsightsService } from './insights.service.js';
import {
  cheapestQuerySchema,
  priceHistoryQuerySchema,
  spendingQuerySchema,
  type InsightsFilters,
  type SpendingQuery,
} from './insights.schemas.js';

// Reportes de solo lectura; las rutas de factura y producto viven aquí para no mezclar
// escrituras y consultas de agregados en el mismo service.
@Controller()
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Get('receipts/:id/comparison')
  comparison(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
  ) {
    return this.insightsService.comparison(user.id, id);
  }

  @Get('products/:id/price-history')
  priceHistory(
    @CurrentUser() user: User,
    @Param('id', { schema: idSchema }) id: string,
    @Query({ schema: priceHistoryQuerySchema }) query: Partial<InsightsFilters>,
  ) {
    return this.insightsService.priceHistory(user.id, id, query);
  }

  @Get('insights/cheapest')
  cheapest(
    @CurrentUser() user: User,
    @Query({ schema: cheapestQuerySchema }) query: InsightsFilters,
  ) {
    return this.insightsService.cheapest(user.id, query);
  }

  @Get('insights/spending')
  spending(
    @CurrentUser() user: User,
    @Query({ schema: spendingQuerySchema }) query: SpendingQuery,
  ) {
    return this.insightsService.spending(user.id, query);
  }
}
