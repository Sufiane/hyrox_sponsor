-- CreateEnum
CREATE TYPE "RaceEntryVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "races" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "races_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "race_entries" (
    "id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "race_id" TEXT NOT NULL,
    "bib_number" TEXT NOT NULL,
    "verification_status" "RaceEntryVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verification_document_url" TEXT,
    "verified_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "race_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "race_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "race_entries_athlete_id_race_date_key" ON "race_entries"("athlete_id", "race_date");

-- AddForeignKey
ALTER TABLE "race_entries" ADD CONSTRAINT "race_entries_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_entries" ADD CONSTRAINT "race_entries_race_id_fkey" FOREIGN KEY ("race_id") REFERENCES "races"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
