-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "body_zone" AS ENUM ('LEFT_PEC', 'RIGHT_PEC', 'UPPER_BACK', 'LOWER_BACK', 'LEFT_ARM', 'RIGHT_ARM', 'LEFT_THIGH', 'RIGHT_THIGH', 'ASS');

-- CreateEnum
CREATE TYPE "race_entry_verification_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "auction_status" AS ENUM ('SCHEDULED', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "auction_outcome" AS ENUM ('PENDING', 'AWAITING_PROOF', 'COMPLETED', 'REFUNDED', 'DISPUTED', 'FORFEITED_FEE');

-- CreateEnum
CREATE TYPE "bid_status" AS ENUM ('LEADING', 'OUTBID', 'WITHDRAWN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "escrow_transaction_type" AS ENUM ('AUTHORIZED', 'VOIDED', 'CAPTURED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "proof_review_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "dispute_status" AS ENUM ('OPEN', 'ARBITRATION', 'RESOLVED_REFUND', 'RESOLVED_UPHELD');

-- CreateTable
CREATE TABLE "athletes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "is_adult" BOOLEAN NOT NULL DEFAULT false,
    "adult_attested_at" TIMESTAMPTZ(3),
    "trust_score" INTEGER NOT NULL DEFAULT 50,
    "strike_count" INTEGER NOT NULL DEFAULT 0,
    "is_banned" BOOLEAN NOT NULL DEFAULT false,
    "lifetime_sponsorship_cents" INTEGER NOT NULL DEFAULT 0,
    "stripe_connect_account_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "athletes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bidders" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "stripe_customer_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bidders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_floor_prices" (
    "id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "zone" "body_zone" NOT NULL,
    "floor_price_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "zone_floor_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "races" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMPTZ(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "races_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "race_entries" (
    "id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "race_id" TEXT NOT NULL,
    "bib_number" TEXT NOT NULL,
    "verification_status" "race_entry_verification_status" NOT NULL DEFAULT 'PENDING',
    "verification_document_url" TEXT,
    "verified_at" TIMESTAMPTZ(3),
    "verified_by" TEXT,
    "race_date" TIMESTAMPTZ(3) NOT NULL,
    "race_local_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "race_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auctions" (
    "id" TEXT NOT NULL,
    "race_entry_id" TEXT NOT NULL,
    "zone" "body_zone" NOT NULL,
    "floor_price_cents" INTEGER NOT NULL,
    "open_at" TIMESTAMPTZ(3) NOT NULL,
    "close_at" TIMESTAMPTZ(3) NOT NULL,
    "proof_deadline_at" TIMESTAMPTZ(3),
    "status" "auction_status" NOT NULL DEFAULT 'SCHEDULED',
    "outcome" "auction_outcome" NOT NULL DEFAULT 'PENDING',
    "current_leading_bid_id" TEXT,
    "commission_cents" INTEGER,
    "processing_fee_cents" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "bidder_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "placed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "bid_status" NOT NULL DEFAULT 'LEADING',

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow_transactions" (
    "id" TEXT NOT NULL,
    "bid_id" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT NOT NULL,
    "type" "escrow_transaction_type" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsorship_proofs" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "media_url" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "review_status" "proof_review_status" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),

    CONSTRAINT "sponsorship_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "raised_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "dispute_status" NOT NULL DEFAULT 'OPEN',
    "resolution_notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strikes" (
    "id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "triggering_auction_id" TEXT,
    "excluded_from_count" BOOLEAN,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strikes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_score_events" (
    "id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "old_value" INTEGER NOT NULL,
    "new_value" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_score_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "athletes_email_key" ON "athletes"("email");

-- CreateIndex
CREATE UNIQUE INDEX "bidders_email_key" ON "bidders"("email");

-- CreateIndex
CREATE UNIQUE INDEX "zone_floor_prices_athlete_id_zone_key" ON "zone_floor_prices"("athlete_id", "zone");

-- CreateIndex
CREATE INDEX "race_entries_race_id_idx" ON "race_entries"("race_id");

-- CreateIndex
CREATE UNIQUE INDEX "race_entries_athlete_id_race_local_date_key" ON "race_entries"("athlete_id", "race_local_date");

-- CreateIndex
CREATE UNIQUE INDEX "auctions_current_leading_bid_id_key" ON "auctions"("current_leading_bid_id");

-- CreateIndex
CREATE INDEX "auctions_status_open_at_close_at_idx" ON "auctions"("status", "open_at", "close_at");

-- CreateIndex
CREATE UNIQUE INDEX "auctions_race_entry_id_zone_key" ON "auctions"("race_entry_id", "zone");

-- CreateIndex
CREATE INDEX "bids_auction_id_status_idx" ON "bids"("auction_id", "status");

-- CreateIndex
CREATE INDEX "bids_bidder_id_idx" ON "bids"("bidder_id");

-- CreateIndex
CREATE INDEX "escrow_transactions_bid_id_type_idx" ON "escrow_transactions"("bid_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "sponsorship_proofs_auction_id_key" ON "sponsorship_proofs"("auction_id");

-- CreateIndex
CREATE INDEX "disputes_auction_id_status_idx" ON "disputes"("auction_id", "status");

-- CreateIndex
CREATE INDEX "strikes_athlete_id_idx" ON "strikes"("athlete_id");

-- CreateIndex
CREATE INDEX "strikes_triggering_auction_id_idx" ON "strikes"("triggering_auction_id");

-- CreateIndex
CREATE INDEX "trust_score_events_athlete_id_idx" ON "trust_score_events"("athlete_id");

-- AddForeignKey
ALTER TABLE "zone_floor_prices" ADD CONSTRAINT "zone_floor_prices_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_entries" ADD CONSTRAINT "race_entries_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_entries" ADD CONSTRAINT "race_entries_race_id_fkey" FOREIGN KEY ("race_id") REFERENCES "races"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_race_entry_id_fkey" FOREIGN KEY ("race_entry_id") REFERENCES "race_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_current_leading_bid_id_fkey" FOREIGN KEY ("current_leading_bid_id") REFERENCES "bids"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "bidders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_bid_id_fkey" FOREIGN KEY ("bid_id") REFERENCES "bids"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsorship_proofs" ADD CONSTRAINT "sponsorship_proofs_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_triggering_auction_id_fkey" FOREIGN KEY ("triggering_auction_id") REFERENCES "auctions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_score_events" ADD CONSTRAINT "trust_score_events_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: Prisma cannot express CHECK constraints in schema.prisma.
ALTER TABLE "zone_floor_prices"
  ADD CONSTRAINT "floor_price_minimum_1000_cents"
  CHECK ("floor_price_cents" >= 1000);

-- Hand-written: Prisma cannot express partial unique indexes in schema.prisma.
CREATE UNIQUE INDEX "bid_one_leading_per_auction"
  ON "bids" ("auction_id")
  WHERE "status" = 'LEADING';
