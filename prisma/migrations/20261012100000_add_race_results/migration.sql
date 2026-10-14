-- CreateEnum
CREATE TYPE "race_result_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "race_results" (
    "id" TEXT NOT NULL,
    "race_entry_id" TEXT NOT NULL,
    "finish_time_seconds" INTEGER NOT NULL,
    "proof_photo_key" TEXT NOT NULL,
    "proof_url" TEXT,
    "status" "race_result_status" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "race_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "race_results_race_entry_id_key" ON "race_results"("race_entry_id");

-- CreateIndex
CREATE INDEX "race_results_status_submitted_at_idx" ON "race_results"("status", "submitted_at");

-- AddForeignKey
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_race_entry_id_fkey" FOREIGN KEY ("race_entry_id") REFERENCES "race_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written constraints (Prisma cannot express these)
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_finish_time_in_range"
  CHECK ("finish_time_seconds" BETWEEN 1800 AND 21600);

ALTER TABLE "race_results" ADD CONSTRAINT "race_results_proof_url_https"
  CHECK ("proof_url" IS NULL OR "proof_url" LIKE 'https://%');

ALTER TABLE "race_results" ADD CONSTRAINT "race_results_review_fields_consistent"
  CHECK (
    (
      "status" = 'PENDING'
      AND "reviewed_by" IS NULL
      AND "reviewed_at" IS NULL
      AND "rejection_reason" IS NULL
    )
    OR (
      "status" = 'VERIFIED'
      AND "reviewed_by" IS NOT NULL
      AND "reviewed_at" IS NOT NULL
      AND "rejection_reason" IS NULL
    )
    OR (
      "status" = 'REJECTED'
      AND "reviewed_by" IS NOT NULL
      AND "reviewed_at" IS NOT NULL
    )
  );
