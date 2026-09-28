-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('LEADING', 'OUTBID', 'WITHDRAWN', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "bids" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "bidder_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "BidStatus" NOT NULL DEFAULT 'LEADING',

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bids_auction_id_status_idx" ON "bids"("auction_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "auctions_current_leading_bid_id_key" ON "auctions"("current_leading_bid_id");

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_current_leading_bid_id_fkey" FOREIGN KEY ("current_leading_bid_id") REFERENCES "bids"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "bidders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE UNIQUE INDEX "bid_one_leading_per_auction"
  ON "bids" ("auction_id")
  WHERE "status" = 'LEADING';
