import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { AthleteId, RaceEntryId, RaceResultId } from '../common/ids';
import type { PrismaService } from '../prisma/prisma.service';
import { RaceResultDb } from './race-result.db';

const photoKey = 'race-results/entry1/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.jpg';
const submittedAt = new Date('2026-10-02T09:00:00Z');
const nested = {
  division: 'SINGLE_OPEN_MEN',
  raceDate: new Date('2026-09-01T00:00:00Z'),
  athlete: { name: 'Jane Doe' },
  race: { name: 'Hyrox Chicago' },
};

describe('RaceResultDb', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let db: RaceResultDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new RaceResultDb(prisma);
  });

  describe('findOwnResult', () => {
    describe('when no result matches the athlete and entry', () => {
      it('returns null and scopes the query to the athlete', async () => {
        prisma.raceResult.findFirst.mockResolvedValue(null);

        await expect(db.findOwnResult('a1' as AthleteId, 'e1' as RaceEntryId)).resolves.toBeNull();

        expect(prisma.raceResult.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: { raceEntryId: 'e1', raceEntry: { athleteId: 'a1' } } }),
        );
      });
    });

    describe('when a result matches', () => {
      it('maps the row without exposing the photo key', async () => {
        prisma.raceResult.findFirst.mockResolvedValue({
          status: 'REJECTED',
          finishTimeSeconds: 4_000,
          proofUrl: null,
          rejectionReason: 'blurry',
          submittedAt,
          reviewedAt: submittedAt,
          raceEntry: { verificationStatus: 'VERIFIED', athlete: { isBanned: false } },
        } as never);

        const record = await db.findOwnResult('a1' as AthleteId, 'e1' as RaceEntryId);

        expect(record).toEqual({
          status: 'REJECTED',
          finishTimeSeconds: 4_000,
          proofUrl: null,
          rejectionReason: 'blurry',
          submittedAt,
          reviewedAt: submittedAt,
          bibVerificationStatus: 'VERIFIED',
          athleteIsBanned: false,
        });
      });
    });
  });

  describe('listPending', () => {
    it('queries pending results oldest first with the limit and maps rows', async () => {
      prisma.raceResult.findMany.mockResolvedValue([
        { id: 'r1', finishTimeSeconds: 4_000, proofUrl: 'https://x.test/a', submittedAt, raceEntry: nested },
      ] as never);

      const items = await db.listPending(50);

      expect(prisma.raceResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PENDING' },
          orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
          take: 50,
        }),
      );
      expect(items).toEqual([
        {
          raceResultId: 'r1',
          athleteName: 'Jane Doe',
          raceName: 'Hyrox Chicago',
          raceDate: nested.raceDate,
          division: 'SINGLE_OPEN_MEN',
          finishTimeSeconds: 4_000,
          hasProofUrl: true,
          submittedAt,
        },
      ]);
    });
  });

  describe('findForStaff', () => {
    describe('when the result does not exist', () => {
      it('returns null', async () => {
        prisma.raceResult.findUnique.mockResolvedValue(null);

        await expect(db.findForStaff('r1' as RaceResultId)).resolves.toBeNull();
      });
    });

    describe('when the result exists', () => {
      it('returns the photo key and link', async () => {
        prisma.raceResult.findUnique.mockResolvedValue({
          id: 'r1',
          finishTimeSeconds: 4_000,
          proofUrl: null,
          proofPhotoKey: photoKey,
          submittedAt,
          raceEntry: nested,
        } as never);

        const record = await db.findForStaff('r1' as RaceResultId);

        expect(record).toMatchObject({ raceResultId: 'r1', proofPhotoKey: photoKey, proofUrl: null });
      });
    });
  });

  describe('listEntriesByAthlete', () => {
    it('queries only the athlete entries, newest race first, and maps the result status', async () => {
      prisma.raceEntry.findMany.mockResolvedValue([
        {
          id: 'e1',
          raceDate: nested.raceDate,
          division: 'SINGLE_OPEN_MEN',
          verificationStatus: 'PENDING',
          race: { name: 'Hyrox Chicago', timezone: 'America/Chicago' },
          raceResult: null,
        },
      ] as never);

      const items = await db.listEntriesByAthlete('a1' as AthleteId, 50);

      expect(prisma.raceEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { athleteId: 'a1' },
          orderBy: [{ raceDate: 'desc' }, { id: 'desc' }],
          take: 50,
        }),
      );
      expect(items).toEqual([
        {
          raceEntryId: 'e1',
          raceName: 'Hyrox Chicago',
          raceDate: nested.raceDate,
          timezone: 'America/Chicago',
          division: 'SINGLE_OPEN_MEN',
          bibVerificationStatus: 'PENDING',
          resultStatus: null,
        },
      ]);
    });
  });
});
