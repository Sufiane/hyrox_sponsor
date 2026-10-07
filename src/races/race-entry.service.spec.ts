import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { RaceEntryService } from './race-entry.service';
import { RaceEntryDb } from './race-entry.db';
import { LogRaceUsecase } from './usecases/log-race/log-race.usecase';
import { ConflictError, NotFoundError } from '../common/domain-error';
import type { DocumentKey } from '../common/document-key';
import type { AthleteId, RaceEntryId, RaceId, StaffId } from '../common/ids';
import { DocumentStorage } from '../storage/document-storage';
import { SubmitVerificationDocumentUsecase } from './usecases/submit-verification-document/submit-verification-document.usecase';
import { ReviewVerificationUsecase } from './usecases/review-verification/review-verification.usecase';
import type { LogRaceInput } from './usecases/log-race/log-race-input';

describe('RaceEntryService', () => {
  let db: DeepMockProxy<RaceEntryDb>;
  let logRace: DeepMockProxy<LogRaceUsecase>;
  let storage: DeepMockProxy<DocumentStorage>;
  let reviewVerification: DeepMockProxy<ReviewVerificationUsecase>;
  let submitDocument: DeepMockProxy<SubmitVerificationDocumentUsecase>;
  let warn: MockInstance;
  let service: RaceEntryService;

  beforeEach(async () => {
    db = mockDeep<RaceEntryDb>();
    logRace = mockDeep<LogRaceUsecase>();
    storage = mockDeep<DocumentStorage>();
    submitDocument = mockDeep<SubmitVerificationDocumentUsecase>();
    reviewVerification = mockDeep<ReviewVerificationUsecase>();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        RaceEntryService,
        { provide: RaceEntryDb, useValue: db },
        { provide: LogRaceUsecase, useValue: logRace },
        { provide: DocumentStorage, useValue: storage },
        { provide: SubmitVerificationDocumentUsecase, useValue: submitDocument },
        { provide: ReviewVerificationUsecase, useValue: reviewVerification },
      ],
    }).compile();
    service = moduleRef.get(RaceEntryService);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('isVerified', () => {
    describe('when no race entry exists', () => {
      beforeEach(() => {
        db.findByAthleteAndRace.mockResolvedValue(null);
      });

      it('returns false', async () => {
        const result = await service.isVerified('athlete-1' as AthleteId, 'race-1' as RaceId);

        expect(result).toBe(false);
      });
    });

    describe('when the race entry is VERIFIED', () => {
      beforeEach(() => {
        db.findByAthleteAndRace.mockResolvedValue({ verificationStatus: 'VERIFIED' } as never);
      });

      it('returns true', async () => {
        const result = await service.isVerified('athlete-1' as AthleteId, 'race-1' as RaceId);

        expect(result).toBe(true);
      });
    });

    describe('when the race entry is PENDING', () => {
      beforeEach(() => {
        db.findByAthleteAndRace.mockResolvedValue({ verificationStatus: 'PENDING' } as never);
      });

      it('returns false', async () => {
        const result = await service.isVerified('athlete-1' as AthleteId, 'race-1' as RaceId);

        expect(result).toBe(false);
      });
    });
  });

  describe('logRace', () => {
    describe('when called', () => {
      const entry = { id: 'entry-1' };
      const body = { name: 'Hyrox Chicago' } as LogRaceInput;

      beforeEach(() => {
        logRace.execute.mockResolvedValue(entry as never);
      });

      it('delegates to the usecase and returns its result', async () => {
        const result = await service.logRace('athlete-1' as AthleteId, body);

        expect(logRace.execute).toHaveBeenCalledWith('athlete-1', body);
        expect(result).toBe(entry);
      });
    });
  });

  describe('assertVerified', () => {
    const entryId = 'entry-1' as RaceEntryId;

    describe('when the race entry does not exist', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue(null);
      });

      it('throws race_entry_not_found and logs', async () => {
        await expect(service.assertVerified(entryId)).rejects.toThrow(NotFoundError);
        await expect(service.assertVerified(entryId)).rejects.toThrow('race_entry_not_found');

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('entry-1'));
      });
    });

    describe('when the race entry is VERIFIED', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ verificationStatus: 'VERIFIED' } as never);
      });

      it('resolves', async () => {
        await expect(service.assertVerified(entryId)).resolves.toBeUndefined();
      });
    });

    describe('when the race entry is PENDING', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ verificationStatus: 'PENDING' } as never);
      });

      it('throws race_entry_not_verified and logs', async () => {
        await expect(service.assertVerified(entryId)).rejects.toThrow(ConflictError);
        await expect(service.assertVerified(entryId)).rejects.toThrow('race_entry_not_verified');

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('entry-1'));
      });
    });

    describe('when the race entry is REJECTED', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ verificationStatus: 'REJECTED' } as never);
      });

      it('throws race_entry_not_verified and logs', async () => {
        await expect(service.assertVerified(entryId)).rejects.toThrow(ConflictError);
        await expect(service.assertVerified(entryId)).rejects.toThrow('race_entry_not_verified');

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('entry-1'));
      });
    });
  });

  describe('isVerifiedById', () => {
    const entryId = 'entry-1' as RaceEntryId;

    describe('when the race entry does not exist', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue(null);
      });

      it('returns false', async () => {
        expect(await service.isVerifiedById(entryId)).toBe(false);
      });
    });

    describe('when the race entry is VERIFIED', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ verificationStatus: 'VERIFIED' } as never);
      });

      it('returns true', async () => {
        expect(await service.isVerifiedById(entryId)).toBe(true);
      });
    });

    describe('when the race entry is PENDING', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ verificationStatus: 'PENDING' } as never);
      });

      it('returns false', async () => {
        expect(await service.isVerifiedById(entryId)).toBe(false);
      });
    });

    describe('when the race entry is REJECTED', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ verificationStatus: 'REJECTED' } as never);
      });

      it('returns false', async () => {
        expect(await service.isVerifiedById(entryId)).toBe(false);
      });
    });
  });

  describe('getVerificationStatus', () => {
    const entryId = 'entry-1' as RaceEntryId;
    const owner = 'athlete-1' as AthleteId;
    const submittedAt = new Date('2026-10-01T10:00:00Z');
    const verifiedAt = new Date('2026-10-02T10:00:00Z');

    describe('when the race entry belongs to another athlete', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ athleteId: 'someone-else' } as never);
      });

      it('throws race_entry_not_found and logs', async () => {
        await expect(service.getVerificationStatus(owner, entryId)).rejects.toThrow(NotFoundError);
        await expect(service.getVerificationStatus(owner, entryId)).rejects.toThrow(
          'race_entry_not_found',
        );

        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the race entry does not exist', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue(null);
      });

      it('throws race_entry_not_found', async () => {
        await expect(service.getVerificationStatus(owner, entryId)).rejects.toThrow(
          'race_entry_not_found',
        );
      });
    });

    describe('when the athlete owns a reviewed race entry with a document', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({
          athleteId: owner,
          bibNumber: '123',
          verificationStatus: 'REJECTED',
          verificationDocumentKey: 'race-entries/entry1/key.pdf',
          verificationRejectionReason: 'blurry',
          verificationSubmittedAt: submittedAt,
          verifiedAt,
        } as never);
      });

      it('returns the view without the document key', async () => {
        const view = await service.getVerificationStatus(owner, entryId);

        expect(view).toEqual({
          raceEntryId: entryId,
          verificationStatus: 'REJECTED',
          bibNumber: '123',
          hasDocument: true,
          rejectionReason: 'blurry',
          submittedAt,
          reviewedAt: verifiedAt,
        });
        expect(view).not.toHaveProperty('documentKey');
      });
    });

    describe('when the athlete owns a race entry without a document', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({
          athleteId: owner,
          bibNumber: null,
          verificationStatus: 'PENDING',
          verificationDocumentKey: null,
          verificationRejectionReason: null,
          verificationSubmittedAt: null,
          verifiedAt: null,
        } as never);
      });

      it('reports hasDocument false', async () => {
        const view = await service.getVerificationStatus(owner, entryId);

        expect(view.hasDocument).toBe(false);
      });
    });
  });

  describe('listAwaitingReview', () => {
    describe('when the db returns records', () => {
      const records = [{ raceEntryId: 'entry-1' }, { raceEntryId: 'entry-2' }];

      beforeEach(() => {
        db.listAwaitingReview.mockResolvedValue(records as never);
      });

      it('returns them using a limit of 50', async () => {
        const items = await service.listAwaitingReview();

        expect(db.listAwaitingReview).toHaveBeenCalledWith(50);
        expect(items).toBe(records);
      });
    });
  });

  describe('getDocumentAccess', () => {
    const entryId = 'entry-1' as RaceEntryId;
    const key = 'race-entries/entry1/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.pdf' as DocumentKey;

    describe('when the race entry does not exist', () => {
      beforeEach(() => {
        db.findDocumentKeyById.mockResolvedValue(null);
      });

      it('throws race_entry_not_found', async () => {
        await expect(service.getDocumentAccess(entryId)).rejects.toThrow(NotFoundError);
        await expect(service.getDocumentAccess(entryId)).rejects.toThrow('race_entry_not_found');

        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the race entry has no document', () => {
      beforeEach(() => {
        db.findDocumentKeyById.mockResolvedValue({ documentKey: null });
      });

      it('throws verification_document_not_found', async () => {
        await expect(service.getDocumentAccess(entryId)).rejects.toThrow(NotFoundError);
        await expect(service.getDocumentAccess(entryId)).rejects.toThrow(
          'verification_document_not_found',
        );

        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the race entry has a document', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
        db.findDocumentKeyById.mockResolvedValue({ documentKey: key });
        storage.signedGetUrl.mockResolvedValue('https://signed.test/doc');
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('returns a 300 second signed url', async () => {
        const access = await service.getDocumentAccess(entryId);

        expect(storage.signedGetUrl).toHaveBeenCalledWith(key, 300);
        expect(access).toEqual({
          url: 'https://signed.test/doc',
          expiresAt: new Date('2026-10-03T12:05:00Z'),
          documentKey: key,
        });
      });
    });
  });

  describe('submitVerificationDocument', () => {
    describe('when called', () => {
      const input = {
        athleteId: 'athlete-1' as AthleteId,
        raceEntryId: 'entry-1' as RaceEntryId,
        bibNumber: 'A1',
        file: Buffer.from('%PDF-1.7'),
      };
      const result = { submittedAt: new Date(), verificationStatus: 'PENDING' as const };

      beforeEach(() => {
        submitDocument.execute.mockResolvedValue(result);
      });

      it('delegates to the usecase and returns its result', async () => {
        expect(await service.submitVerificationDocument(input)).toBe(result);
        expect(submitDocument.execute).toHaveBeenCalledWith(input);
      });
    });
  });

  describe('reviewVerification', () => {
    describe('when called', () => {
      const input = {
        raceEntryId: 'entry-1' as RaceEntryId,
        decision: 'APPROVE' as const,
        reviewerId: 'staff-1' as StaffId,
        reviewedDocumentKey: 'race-entries/entry1/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.pdf' as DocumentKey,
        reason: null,
      };

      beforeEach(() => {
        reviewVerification.execute.mockResolvedValue(undefined);
      });

      it('delegates to the usecase', async () => {
        await service.reviewVerification(input);

        expect(reviewVerification.execute).toHaveBeenCalledWith(input);
      });
    });
  });
});
