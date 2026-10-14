import { Injectable, Logger } from '@nestjs/common';
import { NotFoundError } from '../common/domain-error';
import type { AthleteId, RaceEntryId, RaceResultId } from '../common/ids';
import type { RaceResultStatusCode } from '../common/race-result-status';
import type { Seconds } from '../common/seconds';
import { VERIFICATION_STATUS, type VerificationStatus } from '../common/verification-status';
import { DocumentStorage } from '../storage/document-storage';
import type { RaceDivisionCode } from '../races/race-division';
import { RaceResultDb, type OwnEntryRecord, type PendingResultRecord } from './race-result.db';
import {
  ReviewRaceResultUsecase,
  type ReviewRaceResultInput,
} from './usecases/review-race-result/review-race-result.usecase';
import type {
  SubmitRaceResultInput,
  SubmitRaceResultOutput,
} from './usecases/submit-race-result/submit-race-result-input';
import { SubmitRaceResultUsecase } from './usecases/submit-race-result/submit-race-result.usecase';

const PHOTO_URL_TTL_SECONDS = 300;
const MILLIS_PER_SECOND = 1000;
export const AWAITING_REVIEW_LIMIT = 50;
export const OWN_ENTRIES_LIMIT = 50;

export type OwnResultView = {
  status: RaceResultStatusCode;
  finishTimeSeconds: Seconds;
  proofUrl: string | null;
  hasPhoto: true;
  rejectionReason: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  publicVisible: boolean;
  bibVerificationStatus: VerificationStatus;
};

export type StaffResultDetail = {
  raceResultId: RaceResultId;
  athleteName: string;
  raceName: string;
  raceDate: Date;
  division: RaceDivisionCode;
  finishTimeSeconds: Seconds;
  proofUrl: string | null;
  photoUrl: string;
  photoUrlExpiresAt: Date;
  submittedAt: Date;
};

@Injectable()
export class RaceResultService {
  private readonly logger = new Logger(RaceResultService.name);

  constructor(
    private readonly db: RaceResultDb,
    private readonly storage: DocumentStorage,
    private readonly submitRaceResultUsecase: SubmitRaceResultUsecase,
    private readonly reviewRaceResultUsecase: ReviewRaceResultUsecase,
  ) {}

  submit(input: SubmitRaceResultInput): Promise<SubmitRaceResultOutput> {
    return this.submitRaceResultUsecase.execute(input);
  }

  review(input: ReviewRaceResultInput): Promise<void> {
    return this.reviewRaceResultUsecase.execute(input);
  }

  async getOwnResult(athleteId: AthleteId, raceEntryId: RaceEntryId): Promise<OwnResultView> {
    const record = await this.db.findOwnResult(athleteId, raceEntryId);

    if (!record) {
      this.logger.warn(`Race result for entry ${raceEntryId} not found for athlete ${athleteId}`);

      throw new NotFoundError('race_result_not_found');
    }

    return {
      status: record.status,
      finishTimeSeconds: record.finishTimeSeconds,
      proofUrl: record.proofUrl,
      hasPhoto: true,
      rejectionReason: record.rejectionReason,
      submittedAt: record.submittedAt,
      reviewedAt: record.reviewedAt,
      publicVisible:
        record.bibVerificationStatus === VERIFICATION_STATUS.VERIFIED &&
        !record.athleteIsBanned &&
        record.status !== 'REJECTED',
      bibVerificationStatus: record.bibVerificationStatus,
    };
  }

  listOwnEntries(athleteId: AthleteId): Promise<OwnEntryRecord[]> {
    return this.db.listEntriesByAthlete(athleteId, OWN_ENTRIES_LIMIT);
  }

  listAwaitingReview(): Promise<PendingResultRecord[]> {
    return this.db.listPending(AWAITING_REVIEW_LIMIT);
  }

  async getStaffDetail(id: RaceResultId): Promise<StaffResultDetail> {
    const record = await this.db.findForStaff(id);

    if (!record) {
      this.logger.warn(`Race result ${id} not found`);

      throw new NotFoundError('race_result_not_found');
    }

    const photoUrl = await this.storage.signedGetUrl(record.proofPhotoKey, PHOTO_URL_TTL_SECONDS);

    return {
      raceResultId: record.raceResultId,
      athleteName: record.athleteName,
      raceName: record.raceName,
      raceDate: record.raceDate,
      division: record.division,
      finishTimeSeconds: record.finishTimeSeconds,
      proofUrl: record.proofUrl,
      photoUrl,
      photoUrlExpiresAt: new Date(Date.now() + PHOTO_URL_TTL_SECONDS * MILLIS_PER_SECOND),
      submittedAt: record.submittedAt,
    };
  }
}
