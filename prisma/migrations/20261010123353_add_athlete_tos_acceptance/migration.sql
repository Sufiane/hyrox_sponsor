-- AlterTable
ALTER TABLE "athletes" ADD COLUMN     "tos_accepted_at" TIMESTAMPTZ(3),
ADD COLUMN     "tos_version" TEXT;

-- Hand-written: Prisma cannot express CHECK constraints in schema.prisma.
ALTER TABLE "athletes"
  ADD CONSTRAINT "athletes_tos_acceptance_consistent"
  CHECK ((tos_accepted_at IS NULL) = (tos_version IS NULL));
