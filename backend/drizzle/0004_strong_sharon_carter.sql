-- DEFAULT 0 solo para las filas que ya existen; el código siempre envía position.
ALTER TABLE "receipt_items" ADD COLUMN "position" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "receipt_items" ALTER COLUMN "position" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD COLUMN "new_product" jsonb;
