import { Injectable } from '@nestjs/common';
import { documentKey, type DocumentKey } from '../../../common/document-key';
import type { AthleteId, RaceEntryId } from '../../../common/ids';
import type { VerificationStatus } from '../../../common/verification-status';
import { PrismaService } from '../../../prisma/prisma.service';

export type SubmissionRecord = {
  athleteId: AthleteId;
  raceDate: Date;
  verificationStatus: VerificationStatus;
  verificationDocumentKey: DocumentKey | null;
  athleteIsBanned: boolean;
};

export type MarkSubmittedInput = {
  raceEntryId: RaceEntryId;
  previousKey: DocumentKey | null;
  newKey: DocumentKey;
  bibNumber: string;
  at: Date;
};

@Injectable()
export class SubmitVerificationDocumentUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  async findForSubmission(id: RaceEntryId): Promise<SubmissionRecord | null> {
    const entry = await this.prisma.raceEntry.findUnique({
      where: { id },
      select: {
        athleteId: true,
        raceDate: true,
        verificationStatus: true,
        verificationDocumentKey: true,
        athlete: { select: { isBanned: true } },
      },
    });

    if (!entry) {
      return null;
    }

    return {
      athleteId: entry.athleteId as AthleteId,
      raceDate: entry.raceDate,
      verificationStatus: entry.verificationStatus,
      verificationDocumentKey:
        entry.verificationDocumentKey == null ? null : documentKey(entry.verificationDocumentKey),
      athleteIsBanned: entry.athlete.isBanned,
    };
  }

  async markSubmitted(input: MarkSubmittedInput): Promise<number> {
    const result = await this.prisma.raceEntry.updateMany({
      where: {
        id: input.raceEntryId,
        verificationStatus: { in: ['PENDING', 'REJECTED'] },
        verificationDocumentKey: input.previousKey,
      },
      data: {
        verificationStatus: 'PENDING',
        verificationDocumentKey: input.newKey,
        bibNumber: input.bibNumber,
        verificationSubmittedAt: input.at,
        verifiedAt: null,
        verifiedBy: null,
        verificationRejectionReason: null,
      },
    });

    return result.count;
  }
}
