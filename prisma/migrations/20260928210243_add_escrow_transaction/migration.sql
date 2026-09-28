-- CreateEnum
CREATE TYPE "EscrowTransactionType" AS ENUM ('AUTHORIZED', 'VOIDED', 'CAPTURED', 'REFUNDED', 'FAILED');

-- CreateTable
CREATE TABLE "escrow_transactions" (
    "id" TEXT NOT NULL,
    "bid_id" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT NOT NULL,
    "type" "EscrowTransactionType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "escrow_transactions_bid_id_type_idx" ON "escrow_transactions"("bid_id", "type");

-- AddForeignKey
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_bid_id_fkey" FOREIGN KEY ("bid_id") REFERENCES "bids"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
