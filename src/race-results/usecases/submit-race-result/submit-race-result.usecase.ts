import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAX_DOCUMENT_BYTES } from '../../../common/document-limits';
import { ConflictError, ForbiddenError, InvalidValueError, NotFoundError } from '../../../common/domain-error';
import { detectDocumentType } from '../../../common/document-sniffer';
import type { ProofUrl } from '../../../common/proof-url';
import { buildResultProofKey, type ResultProofExtension, type ResultProofKey } from '../../../common/result-proof-key';
import { VERIFICATION_STATUS } from '../../../common/verification-status';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { DocumentStorage } from '../../../storage/document-storage';
import { parseProofUrl } from '../../proof-url-policy';
import type { SubmitRaceResultInput, SubmitRaceResultOutput } from './submit-race-result-input';
import { SubmitRaceResultUsecaseDb, type SubmissionRecord } from './submit-race-result.usecase.db';

type ValidPhoto = { extension: ResultProofExtension; contentType: string; body: Buffer };

const RESULT_PHOTO_EXTENSIONS: readonly string[] = ['jpg', 'png', 'webp'];

@Injectable()
export class SubmitRaceResultUsecase {
  private readonly logger = new Logger(SubmitRaceResultUsecase.name);

  constructor(
    private readonly db: SubmitRaceResultUsecaseDb,
    private readonly storage: DocumentStorage,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async execute(input: SubmitRaceResultInput): Promise<SubmitRaceResultOutput> {
    const record = await this.db.findForSubmission(input.raceEntryId);
    const now = new Date();

    this.assertEligible(input, record, now);

    const proofUrl = this.parseLink(input.proofUrl);
    const photo = this.validatePhoto(input.photo, record);
    const newKey = photo == null ? null : buildResultProofKey(input.raceEntryId, photo.extension);

    if (photo != null && newKey != null) {
      await this.storage.put(newKey, photo.body, photo.contentType);
    }

    const keptKey = record.existing?.proofPhotoKey ?? null;
    const proofPhotoKey = newKey ?? keptKey;

    if (proofPhotoKey == null) {
      throw new InvalidValueError('proof_photo_missing');
    }

    await this.writeRow(input, record, proofPhotoKey, proofUrl, newKey, now);

    if (newKey != null && keptKey != null) {
      await this.deleteQuietly(keptKey);
    }

    return {
      status: 'PENDING',
      submittedAt: now,
      publicVisible: record.bibVerificationStatus === VERIFICATION_STATUS.VERIFIED,
    };
  }

  private assertEligible(
    input: SubmitRaceResultInput,
    record: SubmissionRecord | null,
    now: Date,
  ): asserts record is SubmissionRecord {
    if (!record || record.athleteId !== input.athleteId) {
      this.logger.warn(`Race entry ${input.raceEntryId} not found for athlete ${input.athleteId}`);

      throw new NotFoundError('race_entry_not_found');
    }

    if (record.athleteIsBanned) {
      this.logger.warn(`Athlete ${input.athleteId} is banned and cannot submit a result`);

      throw new ForbiddenError('athlete_banned');
    }

    if (record.raceDate.getTime() > now.getTime()) {
      this.logger.warn(`Race entry ${input.raceEntryId} race has not finished`);

      throw new ConflictError('race_not_finished');
    }
  }

  private parseLink(raw: string | null): ProofUrl | null {
    if (raw == null || raw.trim() === '') {
      return null;
    }

    return parseProofUrl(raw, this.config.get('RESULT_PROOF_URL_HOSTS', { infer: true }));
  }

  private validatePhoto(photo: Buffer | null, record: SubmissionRecord): ValidPhoto | null {
    if (photo == null && record.existing != null) {
      return null;
    }

    if (photo == null || photo.length === 0) {
      throw new InvalidValueError('proof_photo_missing');
    }

    if (photo.length > MAX_DOCUMENT_BYTES) {
      throw new InvalidValueError('proof_photo_too_large');
    }

    const detected = detectDocumentType(photo);

    if (!detected || !RESULT_PHOTO_EXTENSIONS.includes(detected.extension)) {
      throw new InvalidValueError('proof_photo_type_unsupported');
    }

    return {
      extension: detected.extension as ResultProofExtension,
      contentType: detected.contentType,
      body: photo,
    };
  }

  private async writeRow(
    input: SubmitRaceResultInput,
    record: SubmissionRecord,
    proofPhotoKey: ResultProofKey,
    proofUrl: ProofUrl | null,
    newKey: ResultProofKey | null,
    at: Date,
  ): Promise<void> {
    let written: boolean;

    try {
      written = await this.persist(input, record, proofPhotoKey, proofUrl, at);
    } catch (error) {
      await this.deleteNewQuietly(newKey);

      throw error;
    }

    if (!written) {
      this.logger.warn(`Race entry ${input.raceEntryId} result changed during submission`);
      await this.deleteNewQuietly(newKey);

      throw new ConflictError('result_state_changed');
    }
  }

  private async persist(
    input: SubmitRaceResultInput,
    record: SubmissionRecord,
    proofPhotoKey: ResultProofKey,
    proofUrl: ProofUrl | null,
    at: Date,
  ): Promise<boolean> {
    if (record.existing == null) {
      return this.db.createResult({
        raceEntryId: input.raceEntryId,
        finishTimeSeconds: input.finishTimeSeconds,
        proofPhotoKey,
        proofUrl,
        at,
      });
    }

    const updated = await this.db.updateResult({
      id: record.existing.id,
      expectedSubmittedAt: record.existing.submittedAt,
      finishTimeSeconds: input.finishTimeSeconds,
      proofPhotoKey,
      proofUrl,
      at,
    });

    return updated > 0;
  }

  private async deleteNewQuietly(key: ResultProofKey | null): Promise<void> {
    if (key != null) {
      await this.deleteQuietly(key);
    }
  }

  private async deleteQuietly(key: ResultProofKey): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(`Failed to delete result photo ${key}: ${String(error)}`);
    }
  }
}
