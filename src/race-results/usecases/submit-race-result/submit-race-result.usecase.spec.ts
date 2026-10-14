import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { MAX_DOCUMENT_BYTES } from '../../../common/document-limits';
import { ConflictError, ForbiddenError, InvalidValueError, NotFoundError } from '../../../common/domain-error';
import type { AthleteId, RaceEntryId, RaceResultId } from '../../../common/ids';
import { RESULT_PROOF_KEY_PATTERN, type ResultProofKey } from '../../../common/result-proof-key';
import type { Seconds } from '../../../common/seconds';
import { DocumentStorage } from '../../../storage/document-storage';
import type { SubmitRaceResultInput } from './submit-race-result-input';
import { SubmitRaceResultUsecase } from './submit-race-result.usecase';
import { SubmitRaceResultUsecaseDb, type SubmissionRecord } from './submit-race-result.usecase.db';

const now = new Date('2026-10-03T12:00:00Z');
const athleteId = 'athlete-1' as AthleteId;
const raceEntryId = 'entry1' as RaceEntryId;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const pdf = Buffer.from('%PDF-1.7 test');
const exe = Buffer.from('MZ test');
const oldKey = 'race-results/entry1/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.png' as ResultProofKey;
const oldSubmittedAt = new Date('2026-09-20T10:00:00Z');
const input: SubmitRaceResultInput = {
  athleteId,
  raceEntryId,
  finishTimeSeconds: 4_000 as Seconds,
  proofUrl: null,
  photo: jpeg,
};

const baseRecord: SubmissionRecord = {
  athleteId,
  athleteIsBanned: false,
  raceDate: new Date('2026-09-01T00:00:00Z'),
  bibVerificationStatus: 'VERIFIED',
  existing: null,
};

function withExisting(status: 'PENDING' | 'VERIFIED' | 'REJECTED'): SubmissionRecord {
  return {
    ...baseRecord,
    existing: {
      id: 'result-1' as RaceResultId,
      status,
      proofPhotoKey: oldKey,
      submittedAt: oldSubmittedAt,
    },
  };
}

describe('SubmitRaceResultUsecase', () => {
  let db: DeepMockProxy<SubmitRaceResultUsecaseDb>;
  let storage: DeepMockProxy<DocumentStorage>;
  let usecase: SubmitRaceResultUsecase;
  let warn: MockInstance;

  function run(overrides: Partial<SubmitRaceResultInput> = {}): Promise<unknown> {
    return usecase.execute({ ...input, ...overrides });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db = mockDeep<SubmitRaceResultUsecaseDb>();
    storage = mockDeep<DocumentStorage>();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SubmitRaceResultUsecase,
        { provide: SubmitRaceResultUsecaseDb, useValue: db },
        { provide: DocumentStorage, useValue: storage },
        { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue(['results.example.com']) } },
      ],
    }).compile();
    usecase = moduleRef.get(SubmitRaceResultUsecase);
    db.findForSubmission.mockResolvedValue(baseRecord);
    db.createResult.mockResolvedValue(true);
    db.updateResult.mockResolvedValue(1);
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

    it('throws race_entry_not_found', async () => {
      await expect(run()).rejects.toThrow('race_entry_not_found');
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
    });
  });

  describe('when the race has not finished', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue({ ...baseRecord, raceDate: new Date('2026-11-01T00:00:00Z') });
    });

    it('throws race_not_finished', async () => {
      await expect(run()).rejects.toThrow(ConflictError);
      await expect(run()).rejects.toThrow('race_not_finished');
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('when there is no existing result and no photo', () => {
    it.each([null, Buffer.alloc(0)])('throws proof_photo_missing for %j', async (photo) => {
      await expect(run({ photo })).rejects.toThrow(InvalidValueError);
      await expect(run({ photo })).rejects.toThrow('proof_photo_missing');
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('when the photo is invalid', () => {
    it('rejects an oversized photo', async () => {
      const big = Buffer.concat([jpeg, Buffer.alloc(MAX_DOCUMENT_BYTES)]);

      await expect(run({ photo: big })).rejects.toThrow('proof_photo_too_large');
    });

    it.each([
      ['a pdf', pdf],
      ['an unknown type', exe],
    ])('rejects %s', async (_label, photo) => {
      await expect(run({ photo })).rejects.toThrow('proof_photo_type_unsupported');
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('when the proof link is not allowed', () => {
    it('throws proof_url_host_not_allowed before touching storage', async () => {
      await expect(run({ proofUrl: 'https://evil.test/x' })).rejects.toThrow('proof_url_host_not_allowed');
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('when a new result is created', () => {
    it('stores the photo and creates the row with the allowed link', async () => {
      const result = await run({ proofUrl: ' https://results.example.com/a ' });

      expect(storage.put).toHaveBeenCalledWith(
        expect.stringMatching(RESULT_PROOF_KEY_PATTERN),
        jpeg,
        'image/jpeg',
      );
      expect(db.createResult).toHaveBeenCalledWith({
        raceEntryId,
        finishTimeSeconds: 4_000,
        proofPhotoKey: expect.stringMatching(RESULT_PROOF_KEY_PATTERN),
        proofUrl: 'https://results.example.com/a',
        at: now,
      });
      expect(result).toEqual({ status: 'PENDING', submittedAt: now, publicVisible: true });
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('treats a blank link as absent', async () => {
      await run({ proofUrl: '   ' });

      expect(db.createResult).toHaveBeenCalledWith(expect.objectContaining({ proofUrl: null }));
    });
  });

  describe('when the bib is not verified', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue({ ...baseRecord, bibVerificationStatus: 'PENDING' });
    });

    it('still accepts the result but reports it as not public', async () => {
      await expect(run()).resolves.toEqual({ status: 'PENDING', submittedAt: now, publicVisible: false });
    });
  });

  describe.each(['PENDING', 'VERIFIED', 'REJECTED'] as const)('when a %s result is edited with a new photo', (status) => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue(withExisting(status));
    });

    it('resets the row to pending and deletes the old photo', async () => {
      await expect(run()).resolves.toEqual({ status: 'PENDING', submittedAt: now, publicVisible: true });

      expect(db.updateResult).toHaveBeenCalledWith({
        id: 'result-1',
        expectedSubmittedAt: oldSubmittedAt,
        finishTimeSeconds: 4_000,
        proofPhotoKey: expect.stringMatching(RESULT_PROOF_KEY_PATTERN),
        proofUrl: null,
        at: now,
      });
      expect(db.createResult).not.toHaveBeenCalled();
      expect(storage.delete).toHaveBeenCalledWith(oldKey);
    });
  });

  describe('when the existing result is VERIFIED', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue(withExisting('VERIFIED'));
    });

    it('accepts the edit and sends the result back to PENDING', async () => {
      await expect(run()).resolves.toEqual({ status: 'PENDING', submittedAt: now, publicVisible: true });

      expect(db.updateResult).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'result-1', expectedSubmittedAt: oldSubmittedAt, at: now }),
      );
    });
  });

  describe('when an edit omits the proof link', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue(withExisting('VERIFIED'));
    });

    it('clears the stored link', async () => {
      await run({ proofUrl: null });

      expect(db.updateResult).toHaveBeenCalledWith(expect.objectContaining({ proofUrl: null }));
    });
  });

  describe('when an edit omits the photo', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue(withExisting('VERIFIED'));
    });

    it('keeps the old photo and does not touch storage', async () => {
      await run({ photo: null });

      expect(storage.put).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
      expect(db.updateResult).toHaveBeenCalledWith(expect.objectContaining({ proofPhotoKey: oldKey }));
    });
  });

  describe('when a concurrent edit changes the row', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue(withExisting('PENDING'));
      db.updateResult.mockResolvedValue(0);
    });

    it('throws result_state_changed and removes the new photo', async () => {
      await expect(run()).rejects.toThrow(ConflictError);
      await expect(run()).rejects.toThrow('result_state_changed');

      expect(storage.delete).toHaveBeenCalledWith(expect.stringMatching(RESULT_PROOF_KEY_PATTERN));
      expect(storage.delete).not.toHaveBeenCalledWith(oldKey);
    });
  });

  describe('when a concurrent create wins the unique constraint', () => {
    beforeEach(() => {
      db.createResult.mockResolvedValue(false);
    });

    it('throws result_state_changed and removes the new photo', async () => {
      await expect(run()).rejects.toThrow('result_state_changed');

      expect(storage.delete).toHaveBeenCalledWith(expect.stringMatching(RESULT_PROOF_KEY_PATTERN));
    });
  });

  describe('when the row write throws', () => {
    beforeEach(() => {
      db.createResult.mockRejectedValue(new Error('db down'));
    });

    it('rethrows and removes the new photo', async () => {
      await expect(run()).rejects.toThrow('db down');

      expect(storage.delete).toHaveBeenCalledWith(expect.stringMatching(RESULT_PROOF_KEY_PATTERN));
    });
  });

  describe('when storing the photo fails', () => {
    beforeEach(() => {
      storage.put.mockRejectedValue(new Error('s3 down'));
    });

    it('rethrows and writes nothing', async () => {
      await expect(run()).rejects.toThrow('s3 down');

      expect(db.createResult).not.toHaveBeenCalled();
      expect(db.updateResult).not.toHaveBeenCalled();
    });
  });

  describe('when deleting the old photo fails', () => {
    beforeEach(() => {
      db.findForSubmission.mockResolvedValue(withExisting('PENDING'));
      storage.delete.mockRejectedValue(new Error('s3 down'));
    });

    it('still succeeds', async () => {
      await expect(run()).resolves.toEqual({ status: 'PENDING', submittedAt: now, publicVisible: true });
    });
  });
});
