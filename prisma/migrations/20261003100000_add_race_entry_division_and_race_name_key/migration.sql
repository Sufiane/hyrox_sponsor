-- CreateEnum
CREATE TYPE "race_division" AS ENUM ('SINGLE_OPEN_MEN', 'SINGLE_OPEN_WOMEN', 'SINGLE_PRO_MEN', 'SINGLE_PRO_WOMEN', 'DOUBLES_OPEN_MEN', 'DOUBLES_OPEN_WOMEN', 'DOUBLES_OPEN_MIXED', 'DOUBLES_PRO_MEN', 'DOUBLES_PRO_WOMEN', 'RELAY_MEN', 'RELAY_WOMEN', 'RELAY_MIXED');

-- AlterTable
ALTER TABLE "race_entries" ADD COLUMN     "division" "race_division" NOT NULL,
ALTER COLUMN "bib_number" DROP NOT NULL;

-- AlterTable
ALTER TABLE "races" ADD COLUMN "name_key" TEXT;
UPDATE "races" SET "name_key" = lower(regexp_replace(regexp_replace("name", '^\s+|\s+$', '', 'g'), '\s+', '_', 'g'));
ALTER TABLE "races" ALTER COLUMN "name_key" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "races_name_key_date_timezone_key" ON "races"("name_key", "date", "timezone");

