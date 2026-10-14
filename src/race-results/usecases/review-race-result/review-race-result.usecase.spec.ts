import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { ConflictError, InvalidValueError, NotFoundError } from '../../../common/domain-error';
import type { RaceResultId, StaffId } from '../../../common/ids';
import { ReviewRaceResultUsecase, type ReviewRaceResultInput } from './review-race-result.usecase';
import { ReviewRaceResultUsecaseDb } from './review-race-result.usecase.db';

const now = new Date('2026-10-03T12:00:00Z');
const submittedAt = new Date('2026-10-02T09:00:00.123Z');
const base: ReviewRaceResultInput = {
  raceResultId: 'result-1' as RaceResultId,
  decision: 'APPROVE',
  reviewerId: 'staff-1' as StaffId,
  expectedSubmittedAt: submittedAt,
  reason: null,
};

describe('ReviewRaceResultUsecase', () => {
  let db: DeepMockProxy<ReviewRaceResultUsecaseDb>;
  let usecase: ReviewRaceResultUsecase;
  let warn: MockInstance;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db = mockDeep<ReviewRaceResultUsecaseDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [ReviewRaceResultUsecase, { provide: ReviewRaceResultUsecaseDb, useValue: db }],
    }).compile();
    usecase = moduleRef.get(ReviewRaceResultUsecase);
    db.markReviewed.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  describe('when approving a pending result that was not edited', () => {
    it('marks the result VERIFIED', async () => {
      await usecase.execute(base);

      expect(db.markReviewed).toHaveBeenCalledWith({
        raceResultId: base.raceResultId,
        expectedSubmittedAt: submittedAt,
        decision: 'VERIFIED',
        reviewerId: base.reviewerId,
        rejectionReason: null,
        at: now,
      });
    });
  });

  describe('when approving with a stray reason', () => {
    it('drops the reason', async () => {
      await usecase.execute({ ...base, reason: 'ignored' });

      expect(db.markReviewed).toHaveBeenCalledWith(expect.objectContaining({ rejectionReason: null }));
    });
  });

  describe('when rejecting with a reason', () => {
    it('marks the result REJECTED with the trimmed reason', async () => {
      await usecase.execute({ ...base, decision: 'REJECT', reason: '  clock unreadable  ' });

      expect(db.markReviewed).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'REJECTED', rejectionReason: 'clock unreadable' }),
      );
    });
  });

  describe('when rejecting with a blank reason', () => {
    it.each([null, '', '   '])('throws rejection_reason_required for %j', async (reason) => {
      const input = { ...base, decision: 'REJECT' as const, reason };

      await expect(usecase.execute(input)).rejects.toThrow(InvalidValueError);
      await expect(usecase.execute(input)).rejects.toThrow('rejection_reason_required');

      expect(db.markReviewed).not.toHaveBeenCalled();
    });
  });

  describe('when the compare-and-set update matches no row', () => {
    beforeEach(() => {
      db.markReviewed.mockResolvedValue(0);
    });

    describe('when the result does not exist', () => {
      beforeEach(() => {
        db.findState.mockResolvedValue(null);
      });

      it('throws race_result_not_found', async () => {
        await expect(usecase.execute(base)).rejects.toThrow(NotFoundError);
        await expect(usecase.execute(base)).rejects.toThrow('race_result_not_found');

        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the result is no longer pending', () => {
      beforeEach(() => {
        db.findState.mockResolvedValue({ status: 'VERIFIED', submittedAt });
      });

      it('throws result_not_pending', async () => {
        await expect(usecase.execute(base)).rejects.toThrow(ConflictError);
        await expect(usecase.execute(base)).rejects.toThrow('result_not_pending');

        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the athlete edited the result after it was loaded', () => {
      beforeEach(() => {
        db.findState.mockResolvedValue({ status: 'PENDING', submittedAt: new Date('2026-10-03T11:00:00Z') });
      });

      it('throws result_changed', async () => {
        await expect(usecase.execute(base)).rejects.toThrow(ConflictError);
        await expect(usecase.execute(base)).rejects.toThrow('result_changed');

        expect(warn).toHaveBeenCalled();
      });
    });
  });
});
