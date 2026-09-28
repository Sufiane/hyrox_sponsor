-- CreateEnum
CREATE TYPE "ProofReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'ARBITRATION', 'RESOLVED_REFUND', 'RESOLVED_UPHELD');

-- CreateTable
CREATE TABLE "sponsorship_proofs" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "media_url" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3) NOT NULL,
    "review_status" "ProofReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "sponsorship_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "raised_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sponsorship_proofs_auction_id_key" ON "sponsorship_proofs"("auction_id");

-- CreateIndex
CREATE INDEX "disputes_auction_id_status_idx" ON "disputes"("auction_id", "status");

-- AddForeignKey
ALTER TABLE "sponsorship_proofs" ADD CONSTRAINT "sponsorship_proofs_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

