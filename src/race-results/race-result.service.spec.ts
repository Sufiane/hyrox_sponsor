import { Logger } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { NotFoundError } from '../common/domain-error';
import type { AthleteId, RaceEntryId, RaceResultId } from '../common/ids';
import type { ResultProofKey } from '../common/result-proof-key';
import type { Seconds } from '../common/seconds';
import { DocumentStorage } from '../storage/document-storage';
import { RaceResultDb, type OwnResultRecord, type StaffResultRecord } from './race-result.db';
import {
  AWAITING_REVIEW_LIMIT,
  OWN_ENTRIES_LIMIT,
  RaceResultService,
} from './race-result.service';
import { ReviewRaceResultUsecase } from './usecases/review-race-result/review-race-result.usecase';
import { SubmitRaceResultUsecase } from './usecases/submit-race-result/submit-race-result.usecase';

const now = new Date('2026-10-03T12:00:00Z');
const athleteId = 'athlete-1' as AthleteId;
const raceEntryId = 'entry-1' as RaceEntryId;
const own: OwnResultRecord = {
  status: 'PENDING',
  finishTimeSeconds: 4_000 as Seconds,
  proofUrl: 'https://results.example.com/a',
  rejectionReason: null,
  submittedAt: now,
  reviewedAt: null,
  bibVerificationStatus: 'VERIFIED',
  athleteIsBanned: false,
};

describe('RaceResultService', () => {
  let db: DeepMockProxy<RaceResultDb>;
  let storage: DeepMockProxy<DocumentStorage>;
  let submit: DeepMockProxy<SubmitRaceResultUsecase>;
  let review: DeepMockProxy<ReviewRaceResultUsecase>;
  let service: RaceResultService;
  let warn: MockInstance;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db = mockDeep<RaceResultDb>();
    storage = mockDeep<DocumentStorage>();
    submit = mockDeep<SubmitRaceResultUsecase>();
    review = mockDeep<ReviewRaceResultUsecase>();
    service = new RaceResultService(db, storage, submit, review);
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  describe('getOwnResult', () => {
    describe('when the athlete has no result for the entry', () => {
      it('throws race_result_not_found', async () => {
        db.findOwnResult.mockResolvedValue(null);

        await expect(service.getOwnResult(athleteId, raceEntryId)).rejects.toThrow(NotFoundError);
        await expect(service.getOwnResult(athleteId, raceEntryId)).rejects.toThrow('race_result_not_found');
        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the bib is verified and the result is pending', () => {
      it('is publicly visible', async () => {
        db.findOwnResult.mockResolvedValue(own);

        await expect(service.getOwnResult(athleteId, raceEntryId)).resolves.toMatchObject({
          publicVisible: true,
          hasPhoto: true,
          bibVerificationStatus: 'VERIFIED',
        });
      });
    });

    describe.each([
      ['the bib is not verified', { bibVerificationStatus: 'PENDING' as const }],
      ['the athlete is banned', { athleteIsBanned: true }],
      ['the result was rejected', { status: 'REJECTED' as const }],
    ])('when %s', (_label, patch) => {
      it('is not publicly visible', async () => {
        db.findOwnResult.mockResolvedValue({ ...own, ...patch });

        await expect(service.getOwnResult(athleteId, raceEntryId)).resolves.toMatchObject({
          publicVisible: false,
        });
      });
    });

    it('does not leak the banned flag', async () => {
      db.findOwnResult.mockResolvedValue(own);

      const view = await service.getOwnResult(athleteId, raceEntryId);

      expect(view).not.toHaveProperty('athleteIsBanned');
    });
  });

  describe('listOwnEntries', () => {
    it('caps the list', async () => {
      db.listEntriesByAthlete.mockResolvedValue([]);

      await service.listOwnEntries(athleteId);

      expect(db.listEntriesByAthlete).toHaveBeenCalledWith(athleteId, OWN_ENTRIES_LIMIT);
    });
  });

  describe('listAwaitingReview', () => {
    it('caps the queue', async () => {
      db.listPending.mockResolvedValue([]);

      await service.listAwaitingReview();

      expect(db.listPending).toHaveBeenCalledWith(AWAITING_REVIEW_LIMIT);
    });
  });

  describe('getStaffDetail', () => {
    const id = 'result-1' as RaceResultId;
    const record: StaffResultRecord = {
      raceResultId: id,
      athleteName: 'Jane Doe',
      raceName: 'Hyrox Chicago',
      raceDate: new Date('2026-09-01T00:00:00Z'),
      division: 'SINGLE_OPEN_MEN',
      finishTimeSeconds: 4_000 as Seconds,
      proofUrl: null,
      proofPhotoKey: 'race-results/entry1/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.jpg' as ResultProofKey,
      submittedAt: now,
    };

    describe('when the result does not exist', () => {
      it('throws race_result_not_found', async () => {
        db.findForStaff.mockResolvedValue(null);

        await expect(service.getStaffDetail(id)).rejects.toThrow('race_result_not_found');
        expect(storage.signedGetUrl).not.toHaveBeenCalled();
      });
    });

    describe('when the result exists', () => {
      it('returns a 5-minute signed photo url without the storage key', async () => {
        db.findForStaff.mockResolvedValue(record);
        storage.signedGetUrl.mockResolvedValue('https://signed.test/photo');

        const detail = await service.getStaffDetail(id);

        expect(storage.signedGetUrl).toHaveBeenCalledWith(record.proofPhotoKey, 300);
        expect(detail).toMatchObject({
          photoUrl: 'https://signed.test/photo',
          photoUrlExpiresAt: new Date(now.getTime() + 300_000),
        });
        expect(detail).not.toHaveProperty('proofPhotoKey');
      });
    });
  });

  describe('delegation', () => {
    it('delegates submit and review to the usecases', async () => {
      const submitInput = { athleteId } as never;
      const reviewInput = { raceResultId: 'r' } as never;

      await service.submit(submitInput);
      await service.review(reviewInput);

      expect(submit.execute).toHaveBeenCalledWith(submitInput);
      expect(review.execute).toHaveBeenCalledWith(reviewInput);
    });
  });
});
