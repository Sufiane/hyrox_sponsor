import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, InvalidValueError, NotFoundError } from '../../../common/domain-error';
import type { RaceResultId, StaffId } from '../../../common/ids';
import { RACE_RESULT_STATUS } from '../../../common/race-result-status';
import { ReviewRaceResultUsecaseDb } from './review-race-result.usecase.db';

const DECISION_STATUS = {
  APPROVE: 'VERIFIED',
  REJECT: 'REJECTED',
} as const;

export type ReviewRaceResultInput = {
  raceResultId: RaceResultId;
  decision: 'APPROVE' | 'REJECT';
  reviewerId: StaffId;
  expectedSubmittedAt: Date;
  reason: string | null;
};

@Injectable()
export class ReviewRaceResultUsecase {
  private readonly logger = new Logger(ReviewRaceResultUsecase.name);

  constructor(private readonly db: ReviewRaceResultUsecaseDb) {}

  async execute(input: ReviewRaceResultInput): Promise<void> {
    const reason = input.reason?.trim() ?? '';

    if (input.decision === 'REJECT' && reason === '') {
      throw new InvalidValueError('rejection_reason_required');
    }

    const updated = await this.db.markReviewed({
      raceResultId: input.raceResultId,
      expectedSubmittedAt: input.expectedSubmittedAt,
      decision: DECISION_STATUS[input.decision],
      reviewerId: input.reviewerId,
      rejectionReason: input.decision === 'REJECT' ? reason : null,
      at: new Date(),
    });

    if (updated === 0) {
      await this.throwForMiss(input.raceResultId);
    }
  }

  private async throwForMiss(raceResultId: RaceResultId): Promise<never> {
    const state = await this.db.findState(raceResultId);

    if (!state) {
      this.logger.warn(`Race result ${raceResultId} not found for review`);

      throw new NotFoundError('race_result_not_found');
    }

    if (state.status !== RACE_RESULT_STATUS.PENDING) {
      this.logger.warn(`Race result ${raceResultId} is ${state.status}, not pending`);

      throw new ConflictError('result_not_pending');
    }

    this.logger.warn(`Race result ${raceResultId} was edited since it was reviewed`);

    throw new ConflictError('result_changed');
  }
}
