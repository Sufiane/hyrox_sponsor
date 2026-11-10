-- AlterTable
ALTER TABLE "athletes" ADD COLUMN     "stripe_connect_details_submitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripe_connect_payouts_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripe_connect_synced_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "athletes_stripe_connect_account_id_key" ON "athletes"("stripe_connect_account_id");
