import { type Mock } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { RaceId } from '../common/ids';
import type { Seconds } from '../common/seconds';
import type { PrismaService } from '../prisma/prisma.service';
import { PublicResultsDb } from './public-results.db';

const race = 'race1' as RaceId;
const raceRow = {
  id: 'race1',
  name: 'Hyrox Chicago',
  location: 'Chicago',
  date: new Date('2026-09-01T10:00:00Z'),
  timezone: 'America/Chicago',
};

function expectPublicPredicate(where: unknown, statuses: string[] = ['PENDING', 'VERIFIED']): void {
  expect(where).toMatchObject({
    verificationStatus: 'VERIFIED',
    athlete: { isBanned: false },
    raceResult: { is: { status: { in: statuses } } },
  });
}

describe('PublicResultsDb', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let db: PublicResultsDb;
  let groupBy: Mock;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new PublicResultsDb(prisma);
    groupBy = prisma.raceEntry.groupBy as unknown as Mock;
  });

  describe('listRaces', () => {
    beforeEach(() => {
      prisma.race.findMany.mockResolvedValue([raceRow] as never);
      groupBy
        .mockResolvedValueOnce([{ raceId: 'race1', _count: { _all: 3 } }] as never)
        .mockResolvedValueOnce([{ raceId: 'race1', _count: { _all: 2 } }] as never);
    });

    it('applies the public predicate to the race filter and both count queries', async () => {
      await db.listRaces(21, null);

      const args = prisma.race.findMany.mock.calls[0][0];

      expectPublicPredicate(args?.where?.raceEntries?.some);
      expect(args?.orderBy).toEqual([{ date: 'desc' }, { id: 'desc' }]);
      expect(args?.take).toBe(21);
      expectPublicPredicate(groupBy.mock.calls[0][0].where);
      expectPublicPredicate(groupBy.mock.calls[1][0].where, ['VERIFIED']);
    });

    it('maps counts onto the races', async () => {
      await expect(db.listRaces(21, null)).resolves.toEqual([
        { ...raceRow, resultCount: 3, verifiedCount: 2 },
      ]);
    });

    it('selects only public race columns', async () => {
      await db.listRaces(21, null);

      expect(prisma.race.findMany.mock.calls[0][0]?.select).toEqual({
        id: true,
        name: true,
        location: true,
        date: true,
        timezone: true,
      });
    });

    describe('when a cursor is given', () => {
      it('adds the keyset condition', async () => {
        const cursor = { date: raceRow.date, id: race };

        await db.listRaces(21, cursor);

        expect(prisma.race.findMany.mock.calls[0][0]?.where).toMatchObject({
          OR: [{ date: { lt: cursor.date } }, { date: cursor.date, id: { lt: race } }],
        });
      });
    });
  });

  describe('findRace', () => {
    it('requires a public result and returns null when there is none', async () => {
      prisma.race.findFirst.mockResolvedValue(null);

      await expect(db.findRace(race)).resolves.toBeNull();

      expectPublicPredicate(prisma.race.findFirst.mock.calls[0][0]?.where?.raceEntries?.some);
    });
  });

  describe('listDivisionCounts', () => {
    it('applies the predicate and pairs verified counts', async () => {
      groupBy
        .mockResolvedValueOnce([{ division: 'SINGLE_OPEN_MEN', _count: { _all: 4 } }] as never)
        .mockResolvedValueOnce([] as never);

      await expect(db.listDivisionCounts(race)).resolves.toEqual([
        { division: 'SINGLE_OPEN_MEN', resultCount: 4, verifiedCount: 0 },
      ]);
      expectPublicPredicate(groupBy.mock.calls[0][0].where);
      expectPublicPredicate(groupBy.mock.calls[1][0].where, ['VERIFIED']);
    });
  });

  describe('countVerifiedFasterThan', () => {
    it('counts only verified results strictly faster in the division', async () => {
      prisma.raceEntry.count.mockResolvedValue(7);

      await expect(db.countVerifiedFasterThan(race, 'SINGLE_OPEN_MEN', 4_000 as Seconds)).resolves.toBe(7);

      const where = prisma.raceEntry.count.mock.calls[0][0]?.where;

      expectPublicPredicate(where, ['VERIFIED']);
      expect(where).toMatchObject({
        raceId: { in: ['race1'] },
        division: 'SINGLE_OPEN_MEN',
        raceResult: { is: { finishTimeSeconds: { lt: 4_000 } } },
      });
    });
  });

  describe('countByStatus', () => {
    it('counts verified and pending separately under the predicate', async () => {
      prisma.raceEntry.count.mockResolvedValueOnce(3).mockResolvedValueOnce(5);

      await expect(db.countByStatus(race, 'SINGLE_OPEN_MEN')).resolves.toEqual({ verified: 3, pending: 5 });

      expectPublicPredicate(prisma.raceEntry.count.mock.calls[0][0]?.where, ['VERIFIED']);
      expectPublicPredicate(prisma.raceEntry.count.mock.calls[1][0]?.where, ['PENDING']);
    });
  });

  describe.each([
    ['listVerified', 'VERIFIED'],
    ['listUnverified', 'PENDING'],
  ] as const)('%s', (method, status) => {
    beforeEach(() => {
      prisma.raceEntry.findMany.mockResolvedValue([
        { athlete: { name: 'Jane Doe' }, raceResult: { finishTimeSeconds: 4_000 } },
      ] as never);
    });

    it('applies the predicate, deterministic ordering, paging and a minimal select', async () => {
      const rows = await db[method](race, 'SINGLE_OPEN_MEN', 10, 50);
      const args = prisma.raceEntry.findMany.mock.calls[0][0];

      expectPublicPredicate(args?.where, [status]);
      expect(args?.where).toMatchObject({ division: 'SINGLE_OPEN_MEN', raceId: { in: ['race1'] } });
      expect(args).toMatchObject({
        orderBy: [
          { raceResult: { finishTimeSeconds: 'asc' } },
          { athlete: { name: 'asc' } },
          { raceResult: { id: 'asc' } },
        ],
        skip: 10,
        take: 50,
        select: {
          athlete: { select: { name: true } },
          raceResult: { select: { finishTimeSeconds: true } },
        },
      });
      expect(rows).toEqual([{ athleteName: 'Jane Doe', finishTimeSeconds: 4_000 }]);
    });
  });
});
