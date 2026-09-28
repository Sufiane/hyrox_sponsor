-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('SCHEDULED', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuctionOutcome" AS ENUM ('PENDING', 'AWAITING_PROOF', 'COMPLETED', 'REFUNDED', 'DISPUTED', 'FORFEITED_FEE');

-- CreateTable
CREATE TABLE "auctions" (
    "id" TEXT NOT NULL,
    "race_entry_id" TEXT NOT NULL,
    "zone" "BodyZone" NOT NULL,
    "floor_price_cents" INTEGER NOT NULL,
    "open_at" TIMESTAMP(3) NOT NULL,
    "close_at" TIMESTAMP(3) NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "outcome" "AuctionOutcome" NOT NULL DEFAULT 'PENDING',
    "current_leading_bid_id" TEXT,
    "commission_cents" INTEGER,
    "processing_fee_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auctions_status_open_at_close_at_idx" ON "auctions"("status", "open_at", "close_at");

-- CreateIndex
CREATE UNIQUE INDEX "auctions_race_entry_id_zone_key" ON "auctions"("race_entry_id", "zone");

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_race_entry_id_fkey" FOREIGN KEY ("race_entry_id") REFERENCES "race_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
