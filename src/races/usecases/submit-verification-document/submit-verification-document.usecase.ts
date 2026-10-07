import { Injectable, Logger } from '@nestjs/common';
import {
  ConflictError,
  ForbiddenError,
  InvalidValueError,
  NotFoundError,
} from '../../../common/domain-error';
import { buildDocumentKey, type DocumentKey } from '../../../common/document-key';
import { detectDocumentType, type DetectedDocument } from '../../../common/document-sniffer';
import { MAX_DOCUMENT_BYTES } from '../../../common/document-limits';
import type { AthleteId, RaceEntryId } from '../../../common/ids';
import { VERIFICATION_STATUS } from '../../../common/verification-status';
import { DocumentStorage } from '../../../storage/document-storage';
import {
  SubmitVerificationDocumentUsecaseDb,
  type SubmissionRecord,
} from './submit-verification-document.usecase.db';

export type SubmitVerificationDocumentInput = {
  athleteId: AthleteId;
  raceEntryId: RaceEntryId;
  bibNumber: string;
  file: Buffer;
};

export type SubmitVerificationDocumentResult = {
  submittedAt: Date;
  verificationStatus: 'PENDING';
};

@Injectable()
export class SubmitVerificationDocumentUsecase {
  private readonly logger = new Logger(SubmitVerificationDocumentUsecase.name);

  constructor(
    private readonly db: SubmitVerificationDocumentUsecaseDb,
    private readonly storage: DocumentStorage,
  ) {}

  async execute(input: SubmitVerificationDocumentInput): Promise<SubmitVerificationDocumentResult> {
    const record = await this.db.findForSubmission(input.raceEntryId);
    const now = new Date();

    this.assertEligible(input, record, now);

    const { extension, contentType } = this.assertValidFile(input.file);
    const newKey = buildDocumentKey(input.raceEntryId, extension);

    await this.storage.put(newKey, input.file, contentType);
    await this.markSubmitted(input, record, newKey, now);

    if (record.verificationDocumentKey != null) {
      await this.deleteQuietly(record.verificationDocumentKey);
    }

    return { submittedAt: now, verificationStatus: VERIFICATION_STATUS.PENDING };
  }

  private assertEligible(
    input: SubmitVerificationDocumentInput,
    record: SubmissionRecord | null,
    now: Date,
  ): asserts record is SubmissionRecord {
    if (!record || record.athleteId !== input.athleteId) {
      this.logger.warn(`Race entry ${input.raceEntryId} not found for athlete ${input.athleteId}`);

      throw new NotFoundError('race_entry_not_found');
    }

    if (record.athleteIsBanned) {
      this.logger.warn(`Athlete ${input.athleteId} is banned and cannot submit a document`);

      throw new ForbiddenError('athlete_banned');
    }

    if (record.verificationStatus === VERIFICATION_STATUS.VERIFIED) {
      this.logger.warn(`Race entry ${input.raceEntryId} is already verified`);

      throw new ConflictError('race_entry_already_verified');
    }

    if (record.raceDate.getTime() <= now.getTime()) {
      this.logger.warn(`Race entry ${input.raceEntryId} race date has passed`);

      throw new ConflictError('race_already_started');
    }
  }

  private assertValidFile(file: Buffer): DetectedDocument {
    if (file.length === 0) {
      throw new InvalidValueError('document_missing');
    }

    if (file.length > MAX_DOCUMENT_BYTES) {
      throw new InvalidValueError('document_too_large');
    }

    const detected = detectDocumentType(file);

    if (!detected) {
      throw new InvalidValueError('document_type_unsupported');
    }

    return detected;
  }

  private async markSubmitted(
    input: SubmitVerificationDocumentInput,
    record: SubmissionRecord,
    newKey: DocumentKey,
    at: Date,
  ): Promise<void> {
    let updated: number;

    try {
      updated = await this.db.markSubmitted({
        raceEntryId: input.raceEntryId,
        previousKey: record.verificationDocumentKey,
        newKey,
        bibNumber: input.bibNumber,
        at,
      });
    } catch (error) {
      await this.deleteQuietly(newKey);

      throw error;
    }

    if (updated === 0) {
      this.logger.warn(`Race entry ${input.raceEntryId} changed during submission`);
      await this.deleteQuietly(newKey);

      throw new ConflictError('verification_state_changed');
    }
  }

  private async deleteQuietly(key: DocumentKey): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(`Failed to delete document ${key}: ${String(error)}`);
    }
  }
}
