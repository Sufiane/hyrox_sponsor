import { randomUUID } from 'node:crypto';
import type { Athlete, Auction, Bidder, Prisma, Race, RaceEntry } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

const ONE_DAY_MS = 86_400_000;

function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

export function createAthlete(
  prisma: PrismaService,
  overrides: Partial<Prisma.AthleteUncheckedCreateInput> = {},
): Promise<Athlete> {
  const suffix = uniqueSuffix();

  return prisma.athlete.create({
    data: { name: `Athlete ${suffix}`, email: `athlete-${suffix}@example.com`, passwordHash: 'x', ...overrides },
  });
}

export function createRace(
  prisma: PrismaService,
  overrides: Partial<Prisma.RaceUncheckedCreateInput> = {},
): Promise<Race> {
  const suffix = uniqueSuffix();

  return prisma.race.create({
    data: {
      name: `Race ${suffix}`,
      nameKey: `race-${suffix}`,
      date: new Date(Date.now() + 5 * ONE_DAY_MS),
      timezone: 'America/Chicago',
      location: 'Chicago',
      ...overrides,
    },
  });
}

export async function createRaceEntry(
  prisma: PrismaService,
  overrides: Partial<Prisma.RaceEntryUncheckedCreateInput> = {},
): Promise<RaceEntry> {
  const athleteId = overrides.athleteId ?? (await createAthlete(prisma)).id;
  const raceId = overrides.raceId ?? (await createRace(prisma)).id;

  return prisma.raceEntry.create({
    data: {
      athleteId,
      raceId,
      division: 'SINGLE_OPEN_MEN',
      verificationStatus: 'VERIFIED',
      raceDate: new Date(Date.now() + 5 * ONE_DAY_MS),
      raceLocalDate: new Date('2026-11-14'),
      ...overrides,
    },
  });
}

export async function createAuction(
  prisma: PrismaService,
  overrides: Partial<Prisma.AuctionUncheckedCreateInput> = {},
): Promise<Auction> {
  const raceEntryId = overrides.raceEntryId ?? (await createRaceEntry(prisma)).id;
  const now = Date.now();

  return prisma.auction.create({
    data: {
      raceEntryId,
      zone: 'LEFT_PEC',
      floorPriceCents: 1000,
      openAt: new Date(now - ONE_DAY_MS),
      closeAt: new Date(now + ONE_DAY_MS),
      status: 'OPEN',
      ...overrides,
    },
  });
}

export function createBidder(
  prisma: PrismaService,
  overrides: Partial<Prisma.BidderUncheckedCreateInput> = {},
): Promise<Bidder> {
  return prisma.bidder.create({ data: { email: `bidder-${uniqueSuffix()}@example.com`, ...overrides } });
}
