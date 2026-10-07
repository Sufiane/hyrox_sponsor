import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { ConflictError, ForbiddenError, InvalidValueError, NotFoundError } from '../../../common/domain-error';
import { DOCUMENT_KEY_PATTERN, type DocumentKey } from '../../../common/document-key';
import type { AthleteId, RaceEntryId } from '../../../common/ids';
import { DocumentStorage } from '../../../storage/document-storage';
import { SubmitVerificationDocumentUsecase } from './submit-verification-document.usecase';
import {
  SubmitVerificationDocumentUsecaseDb,
  type SubmissionRecord,
} from './submit-verification-document.usecase.db';

const now = new Date('2026-10-03T12:00:00Z');
const athleteId = 'athlete-1' as AthleteId;
const raceEntryId = 'entry1' as RaceEntryId;
const pdf = Buffer.from('%PDF-1.7 test');
const exe = Buffer.from('MZ test');
const previousKey = 'race-entries/entry1/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.png' as DocumentKey;

const baseRecord: SubmissionRecord = {
  athleteId,
  raceDate: new Date('2027-03-01T00:00:00Z'),
  verificationStatus: 'PENDING',
  verificationDocumentKey: null,
  athleteIsBanned: false,
};

describe('SubmitVerificationDocumentUsecase', () => {
  let db: DeepMockProxy<SubmitVerificationDocumentUsecaseDb>;
  let storage: DeepMockProxy<DocumentStorage>;
  let usecase: SubmitVerificationDocumentUsecase;
  let warn: MockInstance;

  function run(file: Buffer = pdf): Promise<unknown> {
    return usecase.execute({ athleteId, raceEntryId, bibNumber: 'A123', file });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db = mockDeep<SubmitVerificationDocumentUsecaseDb>();
    storage = mockDeep<DocumentStorage>();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SubmitVerificationDocumentUsecase,
        { provide: SubmitVerificationDocumentUsecaseDb, useValue: db },
        { provide: DocumentStorage, useValue: storage },
      ],
    }).compile();
    usecase = moduleRef.get(SubmitVerificationDocumentUsecase);
    db.findForSubmission.mockResolvedValue(baseRecord);
    db.markSubmitted.mockResolvedValue(1);
    storage.put.mockResolvedValue(undefined);
    storage.delete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  describe('when the race entry does not exist', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue(null);
    });

    it('throws race_entry_not_found without touching storage', async () => {
      await expect(run()).rejects.toThrow(NotFoundError);
      await expect(run()).rejects.toThrow('race_entry_not_found');

      expect(warn).toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('when the race entry belongs to another athlete', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue({ ...baseRecord, athleteId: 'other' as AthleteId });
    });

    it('throws race_entry_not_found even for an invalid file', async () => {
      await expect(run(exe)).rejects.toThrow(NotFoundError);
      await expect(run(exe)).rejects.toThrow('race_entry_not_found');

      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('when the athlete is banned', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue({ ...baseRecord, athleteIsBanned: true });
    });

    it('throws athlete_banned', async () => {
      await expect(run()).rejects.toThrow(ForbiddenError);
      await expect(run()).rejects.toThrow('athlete_banned');

      expect(warn).toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('when the race entry is already VERIFIED', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue({ ...baseRecord, verificationStatus: 'VERIFIED' });
    });

    it('throws race_entry_already_verified', async () => {
      await expect(run()).rejects.toThrow(ConflictError);
      await expect(run()).rejects.toThrow('race_entry_already_verified');

      expect(warn).toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('when the race date has passed', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue({ ...baseRecord, raceDate: new Date('2026-10-01T00:00:00Z') });
    });

    it('throws race_already_started', async () => {
      await expect(run()).rejects.toThrow(ConflictError);
      await expect(run()).rejects.toThrow('race_already_started');

      expect(warn).toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('when the file is empty', () => {
    it('throws document_missing', async () => {
      await expect(run(Buffer.alloc(0))).rejects.toThrow(InvalidValueError);
      await expect(run(Buffer.alloc(0))).rejects.toThrow('document_missing');

      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('when the file is larger than 10 MiB', () => {
    it('throws document_too_large', async () => {
      const big = Buffer.alloc(10_485_760 + 1);

      await expect(run(big)).rejects.toThrow(InvalidValueError);
      await expect(run(big)).rejects.toThrow('document_too_large');

      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('when the file type is unsupported', () => {
    it('throws document_type_unsupported', async () => {
      await expect(run(exe)).rejects.toThrow(InvalidValueError);
      await expect(run(exe)).rejects.toThrow('document_type_unsupported');

      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('when a PENDING entry without a document gets a PDF', () => {
    it('stores the object and marks the entry submitted', async () => {
      const result = await run();

      expect(storage.put).toHaveBeenCalledTimes(1);

      const [key, body, contentType] = storage.put.mock.calls[0];

      expect(DOCUMENT_KEY_PATTERN.test(key)).toBe(true);
      expect(body).toBe(pdf);
      expect(contentType).toBe('application/pdf');
      expect(db.markSubmitted).toHaveBeenCalledWith({
        raceEntryId,
        previousKey: null,
        newKey: key,
        bibNumber: 'A123',
        at: now,
      });
      expect(result).toEqual({ submittedAt: now, verificationStatus: 'PENDING' });
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('when a REJECTED entry that had a document is resubmitted', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue({
        ...baseRecord,
        verificationStatus: 'REJECTED',
        verificationDocumentKey: previousKey,
      });
    });

    it('deletes the previous object afterwards', async () => {
      await run();

      expect(db.markSubmitted).toHaveBeenCalledWith(expect.objectContaining({ previousKey }));
      expect(storage.delete).toHaveBeenCalledWith(previousKey);
    });

    describe('when deleting the previous object fails', () => {
      beforeEach(() => {
        storage.delete.mockRejectedValue(new Error('s3 down'));
      });

      it('still resolves and logs a warning', async () => {
        await expect(run()).resolves.toEqual({ submittedAt: now, verificationStatus: 'PENDING' });

        expect(warn).toHaveBeenCalled();
      });
    });
  });

  describe('when the compare-and-set update matches no row', () => {
    beforeEach(() => {
      db.markSubmitted.mockResolvedValue(0);
    });

    it('throws verification_state_changed and removes the new object', async () => {
      await expect(run()).rejects.toThrow(ConflictError);
      await expect(run()).rejects.toThrow('verification_state_changed');

      const [key] = storage.put.mock.calls[0];

      expect(storage.delete).toHaveBeenCalledWith(key);
    });
  });

  describe('when the update throws', () => {
    beforeEach(() => {
      db.markSubmitted.mockRejectedValue(new Error('db down'));
    });

    it('rethrows and removes the new object', async () => {
      await expect(run()).rejects.toThrow('db down');

      const [key] = storage.put.mock.calls[0];

      expect(storage.delete).toHaveBeenCalledWith(key);
    });
  });
});
