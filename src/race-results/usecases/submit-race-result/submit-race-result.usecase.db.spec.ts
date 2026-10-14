import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { RaceResultId } from '../../../common/ids';
import type { ResultProofKey } from '../../../common/result-proof-key';
import type { Seconds } from '../../../common/seconds';
import type { PrismaService } from '../../../prisma/prisma.service';
import { SubmitRaceResultUsecaseDb } from './submit-race-result.usecase.db';

describe('SubmitRaceResultUsecaseDb', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let db: SubmitRaceResultUsecaseDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new SubmitRaceResultUsecaseDb(prisma);
  });

  describe('updateResult', () => {
    it('is conditional on submittedAt and resets status and reviewer fields', async () => {
      const expectedSubmittedAt = new Date('2026-09-20T10:00:00Z');
      const at = new Date('2026-10-03T12:00:00Z');

      prisma.raceResult.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        db.updateResult({
          id: 'r1' as RaceResultId,
          expectedSubmittedAt,
          finishTimeSeconds: 4_000 as Seconds,
          proofPhotoKey: 'race-results/e1/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.jpg' as ResultProofKey,
          proofUrl: null,
          at,
        }),
      ).resolves.toBe(1);

      expect(prisma.raceResult.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', submittedAt: expectedSubmittedAt },
        data: expect.objectContaining({
          status: 'PENDING',
          rejectionReason: null,
          reviewedBy: null,
          reviewedAt: null,
          submittedAt: at,
        }),
      });
    });
  });

  describe('createResult', () => {
    describe('when the unique constraint is violated', () => {
      it('returns false', async () => {
        prisma.raceResult.create.mockRejectedValue({ code: 'P2002' });

        await expect(
          db.createResult({
            raceEntryId: 'e1' as never,
            finishTimeSeconds: 4_000 as Seconds,
            proofPhotoKey: 'race-results/e1/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.jpg' as ResultProofKey,
            proofUrl: null,
            at: new Date(),
          }),
        ).resolves.toBe(false);
      });
    });
  });
});
