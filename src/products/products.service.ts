import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { products } from '../db/schema.js';
import type * as schema from '../db/schema.js';

export type CatalogProduct = Awaited<
  ReturnType<ProductsService['findAll']>
>[number];

@Injectable()
export class ProductsService {
  constructor(
    @InjectDrizzle() private readonly db: NeonDatabase<typeof schema>,
  ) {}

  findAll(userId: string) {
    return this.db
      .select({
        id: products.id,
        name: products.name,
        category: products.category,
        baseUnit: products.baseUnit,
        baseSize: products.baseSize,
      })
      .from(products)
      .where(eq(products.userId, userId))
      .orderBy(products.name);
  }
}
