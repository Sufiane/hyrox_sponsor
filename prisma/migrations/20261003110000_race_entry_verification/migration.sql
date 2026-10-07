-- AlterTable
ALTER TABLE "race_entries" RENAME COLUMN "verification_document_url" TO "verification_document_key";
ALTER TABLE "race_entries"
ADD COLUMN     "verification_rejection_reason" TEXT,
ADD COLUMN     "verification_submitted_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "race_entries_verification_status_verification_submitted_at_idx" ON "race_entries"("verification_status", "verification_submitted_at");
