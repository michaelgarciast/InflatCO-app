import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, ilike, isNull, ne, notExists, sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { stores } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import { escapeLike } from '../common/sql.js';
import type { PatchStoreDto } from './stores.schemas.js';

export type StoreType = (typeof stores.type.enumValues)[number];

@Injectable()
export class StoresService {
  constructor(
    @InjectDrizzle() private readonly db: NeonDatabase<typeof schema>,
  ) {}

  findAll(userId: string, q?: string) {
    return this.db
      .select()
      .from(stores)
      .where(
        and(
          eq(stores.userId, userId),
          q ? ilike(stores.name, `%${escapeLike(q)}%`) : undefined,
        ),
      )
      .orderBy(stores.name);
  }

  async findById(userId: string, id: string) {
    const [store] = await this.db
      .select()
      .from(stores)
      .where(and(eq(stores.id, id), eq(stores.userId, userId)));
    return store ?? null;
  }

  async update(userId: string, id: string, dto: PatchStoreDto) {
    if (dto.nit) {
      const [duplicate] = await this.db
        .select({ id: stores.id })
        .from(stores)
        .where(
          and(
            eq(stores.userId, userId),
            eq(stores.nit, dto.nit),
            ne(stores.id, id),
          ),
        );
      if (duplicate)
        throw new ConflictException('Ya existe otra tienda con ese NIT');
    }

    const [updated] = await this.db
      .update(stores)
      .set(dto)
      .where(and(eq(stores.id, id), eq(stores.userId, userId)))
      .returning();
    if (!updated) throw new NotFoundException('Tienda no encontrada');
    return updated;
  }

  async findOrCreate(userId: string, name: string, type: StoreType) {
    const [existing] = await this.db
      .select()
      .from(stores)
      .where(
        and(
          eq(stores.userId, userId),
          sql`lower(${stores.name}) = lower(${name})`,
        ),
      );
    if (existing) return existing;

    const [created] = await this.db
      .insert(stores)
      .values({ userId, name, type })
      .returning();
    return created;
  }

  // El NIT lo lee la IA de la factura; solo se guarda si la tienda no tiene y ninguna otra lo usa.
  async setNitIfMissing(userId: string, id: string, nit: string) {
    await this.db
      .update(stores)
      .set({ nit })
      .where(
        and(
          eq(stores.id, id),
          eq(stores.userId, userId),
          isNull(stores.nit),
          notExists(
            this.db
              .select({ id: stores.id })
              .from(stores)
              .where(and(eq(stores.userId, userId), eq(stores.nit, nit))),
          ),
        ),
      );
  }
}
