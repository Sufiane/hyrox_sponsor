-- AlterTable
ALTER TABLE "escrow_transactions" ADD COLUMN     "capture_before" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "escrow_transactions_stripe_payment_intent_id_type_key" ON "escrow_transactions"("stripe_payment_intent_id", "type");
