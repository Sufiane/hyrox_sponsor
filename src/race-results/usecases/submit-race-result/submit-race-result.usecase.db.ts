import { Injectable } from '@nestjs/common';
import type { AthleteId, RaceEntryId, RaceResultId } from '../../../common/ids';
import { UNIQUE_VIOLATION } from '../../../common/prisma-error-codes';
import type { ProofUrl } from '../../../common/proof-url';
import type { RaceResultStatusCode } from '../../../common/race-result-status';
import { resultProofKey, type ResultProofKey } from '../../../common/result-proof-key';
import type { Seconds } from '../../../common/seconds';
import type { VerificationStatus } from '../../../common/verification-status';
import { PrismaService } from '../../../prisma/prisma.service';

export type ExistingResult = {
  id: RaceResultId;
  status: RaceResultStatusCode;
  proofPhotoKey: ResultProofKey;
  submittedAt: Date;
};

export type SubmissionRecord = {
  athleteId: AthleteId;
  athleteIsBanned: boolean;
  raceDate: Date;
  bibVerificationStatus: VerificationStatus;
  existing: ExistingResult | null;
};

export type CreateResultInput = {
  raceEntryId: RaceEntryId;
  finishTimeSeconds: Seconds;
  proofPhotoKey: ResultProofKey;
  proofUrl: ProofUrl | null;
  at: Date;
};

export type UpdateResultInput = {
  id: RaceResultId;
  expectedSubmittedAt: Date;
  finishTimeSeconds: Seconds;
  proofPhotoKey: ResultProofKey;
  proofUrl: ProofUrl | null;
  at: Date;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION;
}

@Injectable()
export class SubmitRaceResultUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  async findForSubmission(id: RaceEntryId): Promise<SubmissionRecord | null> {
    const entry = await this.prisma.raceEntry.findUnique({
      where: { id },
      select: {
        athleteId: true,
        raceDate: true,
        verificationStatus: true,
        athlete: { select: { isBanned: true } },
        raceResult: { select: { id: true, status: true, proofPhotoKey: true, submittedAt: true } },
      },
    });

    if (!entry) {
      return null;
    }

    return {
      athleteId: entry.athleteId as AthleteId,
      athleteIsBanned: entry.athlete.isBanned,
      raceDate: entry.raceDate,
      bibVerificationStatus: entry.verificationStatus,
      existing:
        entry.raceResult == null
          ? null
          : {
              id: entry.raceResult.id as RaceResultId,
              status: entry.raceResult.status,
              proofPhotoKey: resultProofKey(entry.raceResult.proofPhotoKey),
              submittedAt: entry.raceResult.submittedAt,
            },
    };
  }

  async createResult(input: CreateResultInput): Promise<boolean> {
    try {
      await this.prisma.raceResult.create({
        data: {
          raceEntryId: input.raceEntryId,
          finishTimeSeconds: input.finishTimeSeconds,
          proofPhotoKey: input.proofPhotoKey,
          proofUrl: input.proofUrl,
          submittedAt: input.at,
        },
      });

      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }

      throw error;
    }
  }

  async updateResult(input: UpdateResultInput): Promise<number> {
    const result = await this.prisma.raceResult.updateMany({
      where: { id: input.id, submittedAt: input.expectedSubmittedAt },
      data: {
        finishTimeSeconds: input.finishTimeSeconds,
        proofPhotoKey: input.proofPhotoKey,
        proofUrl: input.proofUrl,
        status: 'PENDING',
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
        submittedAt: input.at,
      },
    });

    return result.count;
  }
}
