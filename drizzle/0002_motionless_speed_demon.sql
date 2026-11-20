CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"base_unit" text NOT NULL,
	"base_size" numeric(10, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "receipt_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"image_key" text NOT NULL,
	"image_hash" text NOT NULL,
	CONSTRAINT "receipt_images_receipt_position_unique" UNIQUE("receipt_id","position"),
	CONSTRAINT "receipt_images_user_image_hash_unique" UNIQUE("user_id","image_hash"),
	CONSTRAINT "receipt_images_position_check" CHECK ("receipt_images"."position" in (1, 2))
);
--> statement-breakpoint
CREATE TABLE "receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"product_id" uuid,
	"raw_description" text NOT NULL,
	"quantity" numeric(10, 3) NOT NULL,
	"unit" text NOT NULL,
	"unit_price" integer NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"line_total" integer NOT NULL,
	"unit_price_base" numeric(12, 4),
	"confirmed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"purchased_at" timestamp with time zone,
	"total" integer,
	"cufe" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"entry_mode" text DEFAULT 'ai' NOT NULL,
	"unreadable_reason" text,
	"ai_raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_user_id_cufe_unique" UNIQUE("user_id","cufe")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"nit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_user_id_nit_unique" UNIQUE("user_id","nit")
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_images" ADD CONSTRAINT "receipt_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_images" ADD CONSTRAINT "receipt_images_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_user_id_idx" ON "products" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "receipt_images_receipt_id_idx" ON "receipt_images" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipt_items_receipt_id_idx" ON "receipt_items" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipts_user_id_purchased_at_idx" ON "receipts" USING btree ("user_id","purchased_at");--> statement-breakpoint
CREATE INDEX "stores_user_id_idx" ON "stores" USING btree ("user_id");