import { Injectable } from '@nestjs/common';
import type { RaceResultId, StaffId } from '../../../common/ids';
import type { RaceResultStatusCode } from '../../../common/race-result-status';
import { PrismaService } from '../../../prisma/prisma.service';

export type MarkReviewedInput = {
  raceResultId: RaceResultId;
  expectedSubmittedAt: Date;
  decision: Exclude<RaceResultStatusCode, 'PENDING'>;
  reviewerId: StaffId;
  rejectionReason: string | null;
  at: Date;
};

export type ReviewState = {
  status: RaceResultStatusCode;
  submittedAt: Date;
};

@Injectable()
export class ReviewRaceResultUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  async markReviewed(input: MarkReviewedInput): Promise<number> {
    const result = await this.prisma.raceResult.updateMany({
      where: {
        id: input.raceResultId,
        status: 'PENDING',
        submittedAt: input.expectedSubmittedAt,
      },
      data: {
        status: input.decision,
        reviewedBy: input.reviewerId,
        reviewedAt: input.at,
        rejectionReason: input.rejectionReason,
      },
    });

    return result.count;
  }

  findState(id: RaceResultId): Promise<ReviewState | null> {
    return this.prisma.raceResult.findUnique({
      where: { id },
      select: { status: true, submittedAt: true },
    });
  }
}
