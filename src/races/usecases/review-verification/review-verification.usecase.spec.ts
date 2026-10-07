import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { ConflictError, InvalidValueError, NotFoundError } from '../../../common/domain-error';
import type { DocumentKey } from '../../../common/document-key';
import type { RaceEntryId, StaffId } from '../../../common/ids';
import { ReviewVerificationUsecase, type ReviewVerificationInput } from './review-verification.usecase';
import { ReviewVerificationUsecaseDb } from './review-verification.usecase.db';

const now = new Date('2026-10-03T12:00:00Z');
const key = 'race-entries/entry1/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.pdf' as DocumentKey;
const otherKey = 'race-entries/entry1/1b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.pdf' as DocumentKey;
const base: ReviewVerificationInput = {
  raceEntryId: 'entry1' as RaceEntryId,
  decision: 'APPROVE',
  reviewerId: 'staff-1' as StaffId,
  reviewedDocumentKey: key,
  reason: null,
};

describe('ReviewVerificationUsecase', () => {
  let db: DeepMockProxy<ReviewVerificationUsecaseDb>;
  let usecase: ReviewVerificationUsecase;
  let warn: MockInstance;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db = mockDeep<ReviewVerificationUsecaseDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [ReviewVerificationUsecase, { provide: ReviewVerificationUsecaseDb, useValue: db }],
    }).compile();
    usecase = moduleRef.get(ReviewVerificationUsecase);
    db.markReviewed.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  describe('when approving a pending entry with the matching document', () => {
    it('marks the entry VERIFIED', async () => {
      await usecase.execute(base);

      expect(db.markReviewed).toHaveBeenCalledWith({
        raceEntryId: base.raceEntryId,
        expectedDocumentKey: key,
        decision: 'VERIFIED',
        reviewerId: base.reviewerId,
        rejectionReason: null,
        at: now,
      });
    });
  });

  describe('when rejecting with a reason', () => {
    it('marks the entry REJECTED with the trimmed reason', async () => {
      await usecase.execute({ ...base, decision: 'REJECT', reason: '  blurry  ' });

      expect(db.markReviewed).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'REJECTED', rejectionReason: 'blurry' }),
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

    describe('when the race entry does not exist', () => {
      beforeEach(() => {
        db.findState.mockResolvedValue(null);
      });

      it('throws race_entry_not_found', async () => {
        await expect(usecase.execute(base)).rejects.toThrow(NotFoundError);
        await expect(usecase.execute(base)).rejects.toThrow('race_entry_not_found');

        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the entry is no longer pending', () => {
      beforeEach(() => {
        db.findState.mockResolvedValue({ verificationStatus: 'VERIFIED', verificationDocumentKey: key });
      });

      it('throws verification_not_pending', async () => {
        await expect(usecase.execute(base)).rejects.toThrow(ConflictError);
        await expect(usecase.execute(base)).rejects.toThrow('verification_not_pending');

        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the athlete uploaded a different document', () => {
      beforeEach(() => {
        db.findState.mockResolvedValue({ verificationStatus: 'PENDING', verificationDocumentKey: otherKey });
      });

      it('throws verification_document_changed', async () => {
        await expect(usecase.execute(base)).rejects.toThrow(ConflictError);
        await expect(usecase.execute(base)).rejects.toThrow('verification_document_changed');

        expect(warn).toHaveBeenCalled();
      });
    });
  });
});
