-- AlterTable
ALTER TABLE "bidders" ADD COLUMN "card_brand" TEXT,
ADD COLUMN "card_last4" TEXT,
ADD COLUMN "default_payment_method_id" TEXT,
ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

-- Hand-written: a card is stored whole or not at all (HYR-60 writes it in one update).
ALTER TABLE "bidders" ADD CONSTRAINT "bidders_card_all_or_none_check" CHECK (
  ("default_payment_method_id" IS NULL AND "card_brand" IS NULL AND "card_last4" IS NULL)
  OR ("default_payment_method_id" IS NOT NULL AND "card_brand" IS NOT NULL AND "card_last4" IS NOT NULL AND "card_last4" ~ '^[0-9]{4}$')
);
