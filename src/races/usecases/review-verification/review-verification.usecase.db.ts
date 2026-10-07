import { Injectable } from '@nestjs/common';
import { documentKey, type DocumentKey } from '../../../common/document-key';
import type { RaceEntryId, StaffId } from '../../../common/ids';
import type { VerificationStatus } from '../../../common/verification-status';
import { PrismaService } from '../../../prisma/prisma.service';

export type MarkReviewedInput = {
  raceEntryId: RaceEntryId;
  expectedDocumentKey: DocumentKey;
  decision: Exclude<VerificationStatus, 'PENDING'>;
  reviewerId: StaffId;
  rejectionReason: string | null;
  at: Date;
};

export type ReviewState = {
  verificationStatus: VerificationStatus;
  verificationDocumentKey: DocumentKey | null;
};

@Injectable()
export class ReviewVerificationUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  async markReviewed(input: MarkReviewedInput): Promise<number> {
    const result = await this.prisma.raceEntry.updateMany({
      where: {
        id: input.raceEntryId,
        verificationStatus: 'PENDING',
        verificationDocumentKey: input.expectedDocumentKey,
      },
      data: {
        verificationStatus: input.decision,
        verifiedAt: input.at,
        verifiedBy: input.reviewerId,
        verificationRejectionReason: input.rejectionReason,
      },
    });

    return result.count;
  }

  async findState(id: RaceEntryId): Promise<ReviewState | null> {
    const entry = await this.prisma.raceEntry.findUnique({
      where: { id },
      select: { verificationStatus: true, verificationDocumentKey: true },
    });

    if (!entry) {
      return null;
    }

    return {
      verificationStatus: entry.verificationStatus,
      verificationDocumentKey:
        entry.verificationDocumentKey == null ? null : documentKey(entry.verificationDocumentKey),
    };
  }
}
