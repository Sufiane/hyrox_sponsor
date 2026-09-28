-- CreateEnum
CREATE TYPE "BodyZone" AS ENUM ('LEFT_PEC', 'RIGHT_PEC', 'UPPER_BACK', 'LOWER_BACK', 'LEFT_ARM', 'RIGHT_ARM', 'LEFT_THIGH', 'RIGHT_THIGH', 'ASS');

-- CreateTable
CREATE TABLE "athletes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "is_adult" BOOLEAN NOT NULL DEFAULT false,
    "adult_attested_at" TIMESTAMP(3),
    "trust_score" INTEGER NOT NULL DEFAULT 50,
    "strike_count" INTEGER NOT NULL DEFAULT 0,
    "is_banned" BOOLEAN NOT NULL DEFAULT false,
    "lifetime_sponsorship_cents" INTEGER NOT NULL DEFAULT 0,
    "stripe_connect_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "athletes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "athletes_email_key" ON "athletes"("email");
