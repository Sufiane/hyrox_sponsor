import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, InvalidValueError, NotFoundError } from '../../../common/domain-error';
import type { DocumentKey } from '../../../common/document-key';
import type { RaceEntryId, StaffId } from '../../../common/ids';
import { VERIFICATION_STATUS } from '../../../common/verification-status';
import { ReviewVerificationUsecaseDb } from './review-verification.usecase.db';

const DECISION_STATUS = {
  APPROVE: 'VERIFIED',
  REJECT: 'REJECTED',
} as const;

export type ReviewVerificationInput = {
  raceEntryId: RaceEntryId;
  decision: 'APPROVE' | 'REJECT';
  reviewerId: StaffId;
  reviewedDocumentKey: DocumentKey;
  reason: string | null;
};

@Injectable()
export class ReviewVerificationUsecase {
  private readonly logger = new Logger(ReviewVerificationUsecase.name);

  constructor(private readonly db: ReviewVerificationUsecaseDb) {}

  async execute(input: ReviewVerificationInput): Promise<void> {
    const reason = input.reason?.trim() ?? '';

    if (input.decision === 'REJECT' && reason === '') {
      throw new InvalidValueError('rejection_reason_required');
    }

    const updated = await this.db.markReviewed({
      raceEntryId: input.raceEntryId,
      expectedDocumentKey: input.reviewedDocumentKey,
      decision: DECISION_STATUS[input.decision],
      reviewerId: input.reviewerId,
      rejectionReason: input.decision === 'REJECT' ? reason : null,
      at: new Date(),
    });

    if (updated === 0) {
      await this.throwForMiss(input.raceEntryId);
    }
  }

  private async throwForMiss(raceEntryId: RaceEntryId): Promise<never> {
    const state = await this.db.findState(raceEntryId);

    if (!state) {
      this.logger.warn(`Race entry ${raceEntryId} not found for review`);

      throw new NotFoundError('race_entry_not_found');
    }

    if (state.verificationStatus !== VERIFICATION_STATUS.PENDING) {
      this.logger.warn(`Race entry ${raceEntryId} is ${state.verificationStatus}, not pending`);

      throw new ConflictError('verification_not_pending');
    }

    this.logger.warn(`Race entry ${raceEntryId} document changed since it was reviewed`);

    throw new ConflictError('verification_document_changed');
  }
}
