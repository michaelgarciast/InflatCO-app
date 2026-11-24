import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export interface NewProduct {
  name: string;
  category: string;
  baseUnit: 'g' | 'ml' | 'und';
  baseSize: number;
}

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    lastActiveAt: timestamp('last_active_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    mfa: text('mfa', { enum: ['pending', 'verified'] }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

// Solo el hash del token: la fila filtrada no habilita un reset.
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('password_reset_tokens_user_id_idx').on(table.userId)],
);

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type', { enum: ['cadena', 'plaza', 'barrio'] }).notNull(),
    nit: text('nit'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('stores_user_id_nit_unique').on(table.userId, table.nit),
    index('stores_user_id_idx').on(table.userId),
  ],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').notNull(),
    baseUnit: text('base_unit', { enum: ['g', 'ml', 'und'] }).notNull(),
    baseSize: numeric('base_size', { precision: 10, scale: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('products_user_id_name_unique').on(table.userId, table.name),
    index('products_user_id_idx').on(table.userId),
  ],
);

export const receipts = pgTable(
  'receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    // Día calendario de la factura en Bogotá: un timestamp lo correría al día anterior en UTC.
    purchasedAt: date('purchased_at', { mode: 'string' }),
    total: integer('total'),
    cufe: text('cufe'),
    status: text('status', { enum: ['unreadable', 'draft', 'confirmed'] })
      .notNull()
      .default('draft'),
    entryMode: text('entry_mode', { enum: ['ai', 'manual'] })
      .notNull()
      .default('ai'),
    unreadableReason: text('unreadable_reason'),
    aiRaw: jsonb('ai_raw'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('receipts_user_id_cufe_unique').on(table.userId, table.cufe),
    index('receipts_user_id_purchased_at_idx').on(
      table.userId,
      table.purchasedAt,
    ),
  ],
);

export const receiptImages = pgTable(
  'receipt_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    imageKey: text('image_key').notNull(),
    imageHash: text('image_hash').notNull(),
  },
  (table) => [
    check('receipt_images_position_check', sql`${table.position} in (1, 2)`),
    unique('receipt_images_receipt_position_unique').on(
      table.receiptId,
      table.position,
    ),
    unique('receipt_images_user_image_hash_unique').on(
      table.userId,
      table.imageHash,
    ),
    index('receipt_images_receipt_id_idx').on(table.receiptId),
  ],
);

export const receiptItems = pgTable(
  'receipt_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    rawDescription: text('raw_description').notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 3 }).notNull(),
    unit: text('unit', { enum: ['kg', 'g', 'l', 'ml', 'und'] }).notNull(),
    unitPrice: integer('unit_price').notNull(),
    discount: integer('discount').notNull().default(0),
    lineTotal: integer('line_total').notNull(),
    unitPriceBase: numeric('unit_price_base', { precision: 12, scale: 4 }),
    confirmed: boolean('confirmed').notNull().default(false),
    // Orden de la línea en la factura: sin esto la lista cambia de orden con cada UPDATE.
    position: integer('position').notNull(),
    // Producto que se crea al confirmar la factura si la línea no tiene productId.
    newProduct: jsonb('new_product').$type<NewProduct>(),
  },
  (table) => [index('receipt_items_receipt_id_idx').on(table.receiptId)],
);
