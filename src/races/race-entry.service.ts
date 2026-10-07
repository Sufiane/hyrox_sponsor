import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../common/domain-error';
import type { DocumentKey } from '../common/document-key';
import type { AthleteId, RaceEntryId, RaceId } from '../common/ids';
import { VERIFICATION_STATUS, type VerificationStatus } from '../common/verification-status';
import { DocumentStorage } from '../storage/document-storage';
import { RaceEntryDb, type AwaitingReviewRecord } from './race-entry.db';
import type { LogRaceInput } from './usecases/log-race/log-race-input';
import { LogRaceUsecase, type LogRaceResult } from './usecases/log-race/log-race.usecase';
import {
  ReviewVerificationUsecase,
  type ReviewVerificationInput,
} from './usecases/review-verification/review-verification.usecase';
import {
  SubmitVerificationDocumentUsecase,
  type SubmitVerificationDocumentInput,
  type SubmitVerificationDocumentResult,
} from './usecases/submit-verification-document/submit-verification-document.usecase';

const DOCUMENT_URL_TTL_SECONDS = 300;
const AWAITING_REVIEW_LIMIT = 50;
const MILLIS_PER_SECOND = 1000;

export type VerificationStatusView = {
  raceEntryId: RaceEntryId;
  verificationStatus: VerificationStatus;
  bibNumber: string | null;
  hasDocument: boolean;
  rejectionReason: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
};

export type AwaitingReviewItem = AwaitingReviewRecord;

export type DocumentAccess = { url: string; expiresAt: Date; documentKey: DocumentKey };

@Injectable()
export class RaceEntryService {
  private readonly logger = new Logger(RaceEntryService.name);

  constructor(
    private readonly db: RaceEntryDb,
    private readonly logRaceUsecase: LogRaceUsecase,
    private readonly storage: DocumentStorage,
    private readonly submitVerificationDocumentUsecase: SubmitVerificationDocumentUsecase,
    private readonly reviewVerificationUsecase: ReviewVerificationUsecase,
  ) {}

  logRace(athleteId: AthleteId, input: LogRaceInput): Promise<LogRaceResult> {
    return this.logRaceUsecase.execute(athleteId, input);
  }

  submitVerificationDocument(
    input: SubmitVerificationDocumentInput,
  ): Promise<SubmitVerificationDocumentResult> {
    return this.submitVerificationDocumentUsecase.execute(input);
  }

  reviewVerification(input: ReviewVerificationInput): Promise<void> {
    return this.reviewVerificationUsecase.execute(input);
  }

  async isVerified(athleteId: AthleteId, raceId: RaceId): Promise<boolean> {
    const entry = await this.db.findByAthleteAndRace(athleteId, raceId);

    if (!entry) {
      return false;
    }

    return entry.verificationStatus === VERIFICATION_STATUS.VERIFIED;
  }

  async isVerifiedById(raceEntryId: RaceEntryId): Promise<boolean> {
    const entry = await this.db.findById(raceEntryId);

    if (!entry) {
      return false;
    }

    return entry.verificationStatus === VERIFICATION_STATUS.VERIFIED;
  }

  async assertVerified(raceEntryId: RaceEntryId): Promise<void> {
    const entry = await this.db.findById(raceEntryId);

    if (!entry) {
      this.logger.warn(`Race entry ${raceEntryId} not found`);

      throw new NotFoundError('race_entry_not_found');
    }

    if (entry.verificationStatus !== VERIFICATION_STATUS.VERIFIED) {
      this.logger.warn(`Race entry ${raceEntryId} is ${entry.verificationStatus}, not VERIFIED`);

      throw new ConflictError('race_entry_not_verified');
    }
  }

  async getVerificationStatus(
    athleteId: AthleteId,
    raceEntryId: RaceEntryId,
  ): Promise<VerificationStatusView> {
    const entry = await this.db.findById(raceEntryId);

    if (!entry || entry.athleteId !== athleteId) {
      this.logger.warn(`Race entry ${raceEntryId} not found for athlete ${athleteId}`);

      throw new NotFoundError('race_entry_not_found');
    }

    return {
      raceEntryId,
      verificationStatus: entry.verificationStatus,
      bibNumber: entry.bibNumber,
      hasDocument: entry.verificationDocumentKey != null,
      rejectionReason: entry.verificationRejectionReason,
      submittedAt: entry.verificationSubmittedAt,
      reviewedAt: entry.verifiedAt,
    };
  }

  listAwaitingReview(): Promise<AwaitingReviewItem[]> {
    return this.db.listAwaitingReview(AWAITING_REVIEW_LIMIT);
  }

  async getDocumentAccess(raceEntryId: RaceEntryId): Promise<DocumentAccess> {
    const found = await this.db.findDocumentKeyById(raceEntryId);

    if (!found) {
      this.logger.warn(`Race entry ${raceEntryId} not found`);

      throw new NotFoundError('race_entry_not_found');
    }

    if (found.documentKey == null) {
      this.logger.warn(`Race entry ${raceEntryId} has no verification document`);

      throw new NotFoundError('verification_document_not_found');
    }

    const url = await this.storage.signedGetUrl(found.documentKey, DOCUMENT_URL_TTL_SECONDS);

    return {
      url,
      expiresAt: new Date(Date.now() + DOCUMENT_URL_TTL_SECONDS * MILLIS_PER_SECOND),
      documentKey: found.documentKey,
    };
  }
}
