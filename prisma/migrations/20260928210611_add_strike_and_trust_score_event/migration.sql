-- CreateTable
CREATE TABLE "strikes" (
    "id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "triggering_auction_id" TEXT,
    "excluded_from_count" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strikes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_score_events" (
    "id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "old_value" INTEGER NOT NULL,
    "new_value" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_score_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strikes_athlete_id_idx" ON "strikes"("athlete_id");

-- CreateIndex
CREATE INDEX "trust_score_events_athlete_id_idx" ON "trust_score_events"("athlete_id");

-- AddForeignKey
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_score_events" ADD CONSTRAINT "trust_score_events_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
