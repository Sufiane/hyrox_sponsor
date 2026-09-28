-- CreateTable
CREATE TABLE "zone_floor_prices" (
    "id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "zone" "BodyZone" NOT NULL,
    "floor_price_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zone_floor_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zone_floor_prices_athlete_id_zone_key" ON "zone_floor_prices"("athlete_id", "zone");

-- AddForeignKey
ALTER TABLE "zone_floor_prices" ADD CONSTRAINT "zone_floor_prices_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: Prisma cannot express CHECK constraints in schema.prisma.
ALTER TABLE "zone_floor_prices"
  ADD CONSTRAINT "floor_price_minimum_1000_cents"
  CHECK ("floor_price_cents" >= 1000);
