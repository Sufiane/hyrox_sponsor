/*
  Warnings:

  - Added the required column `password_hash` to the `athletes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "athletes" ADD COLUMN     "password_hash" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_athlete_id_idx" ON "refresh_tokens"("athlete_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: Prisma cannot express CHECK constraints in schema.prisma.
ALTER TABLE "athletes"
  ADD CONSTRAINT "athletes_adult_attestation_consistent"
  CHECK (is_adult = false OR adult_attested_at IS NOT NULL);
