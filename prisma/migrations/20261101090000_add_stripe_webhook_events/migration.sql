-- CreateEnum
CREATE TYPE "stripe_webhook_channel" AS ENUM ('PLATFORM', 'CONNECT');

-- CreateTable
CREATE TABLE "stripe_webhook_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "stripe_webhook_channel" NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ(3),
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);
