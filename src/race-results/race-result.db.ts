import { Injectable } from '@nestjs/common';
import type { AthleteId, RaceEntryId, RaceResultId } from '../common/ids';
import type { RaceResultStatusCode } from '../common/race-result-status';
import { resultProofKey, type ResultProofKey } from '../common/result-proof-key';
import { seconds, type Seconds } from '../common/seconds';
import type { VerificationStatus } from '../common/verification-status';
import { PrismaService } from '../prisma/prisma.service';
import type { RaceDivisionCode } from '../races/race-division';

export type OwnResultRecord = {
  status: RaceResultStatusCode;
  finishTimeSeconds: Seconds;
  proofUrl: string | null;
  rejectionReason: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  bibVerificationStatus: VerificationStatus;
  athleteIsBanned: boolean;
};

export type PendingResultRecord = {
  raceResultId: RaceResultId;
  athleteName: string;
  raceName: string;
  raceDate: Date;
  division: RaceDivisionCode;
  finishTimeSeconds: Seconds;
  hasProofUrl: boolean;
  submittedAt: Date;
};

export type StaffResultRecord = {
  raceResultId: RaceResultId;
  athleteName: string;
  raceName: string;
  raceDate: Date;
  division: RaceDivisionCode;
  finishTimeSeconds: Seconds;
  proofUrl: string | null;
  proofPhotoKey: ResultProofKey;
  submittedAt: Date;
};

export type OwnEntryRecord = {
  raceEntryId: RaceEntryId;
  raceName: string;
  raceDate: Date;
  timezone: string;
  division: RaceDivisionCode;
  bibVerificationStatus: VerificationStatus;
  resultStatus: RaceResultStatusCode | null;
};

@Injectable()
export class RaceResultDb {
  constructor(private readonly prisma: PrismaService) {}

  async findOwnResult(athleteId: AthleteId, raceEntryId: RaceEntryId): Promise<OwnResultRecord | null> {
    const result = await this.prisma.raceResult.findFirst({
      where: { raceEntryId, raceEntry: { athleteId } },
      select: {
        status: true,
        finishTimeSeconds: true,
        proofUrl: true,
        rejectionReason: true,
        submittedAt: true,
        reviewedAt: true,
        raceEntry: {
          select: { verificationStatus: true, athlete: { select: { isBanned: true } } },
        },
      },
    });

    if (!result) {
      return null;
    }

    return {
      status: result.status,
      finishTimeSeconds: seconds(result.finishTimeSeconds),
      proofUrl: result.proofUrl,
      rejectionReason: result.rejectionReason,
      submittedAt: result.submittedAt,
      reviewedAt: result.reviewedAt,
      bibVerificationStatus: result.raceEntry.verificationStatus,
      athleteIsBanned: result.raceEntry.athlete.isBanned,
    };
  }

  async listPending(limit: number): Promise<PendingResultRecord[]> {
    const results = await this.prisma.raceResult.findMany({
      where: { status: 'PENDING' },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        finishTimeSeconds: true,
        proofUrl: true,
        submittedAt: true,
        raceEntry: {
          select: {
            division: true,
            raceDate: true,
            athlete: { select: { name: true } },
            race: { select: { name: true } },
          },
        },
      },
    });

    return results.map((result) => ({
      raceResultId: result.id as RaceResultId,
      athleteName: result.raceEntry.athlete.name,
      raceName: result.raceEntry.race.name,
      raceDate: result.raceEntry.raceDate,
      division: result.raceEntry.division,
      finishTimeSeconds: seconds(result.finishTimeSeconds),
      hasProofUrl: result.proofUrl != null,
      submittedAt: result.submittedAt,
    }));
  }

  async findForStaff(id: RaceResultId): Promise<StaffResultRecord | null> {
    const result = await this.prisma.raceResult.findUnique({
      where: { id },
      select: {
        id: true,
        finishTimeSeconds: true,
        proofUrl: true,
        proofPhotoKey: true,
        submittedAt: true,
        raceEntry: {
          select: {
            division: true,
            raceDate: true,
            athlete: { select: { name: true } },
            race: { select: { name: true } },
          },
        },
      },
    });

    if (!result) {
      return null;
    }

    return {
      raceResultId: result.id as RaceResultId,
      athleteName: result.raceEntry.athlete.name,
      raceName: result.raceEntry.race.name,
      raceDate: result.raceEntry.raceDate,
      division: result.raceEntry.division,
      finishTimeSeconds: seconds(result.finishTimeSeconds),
      proofUrl: result.proofUrl,
      proofPhotoKey: resultProofKey(result.proofPhotoKey),
      submittedAt: result.submittedAt,
    };
  }

  async listEntriesByAthlete(athleteId: AthleteId, limit: number): Promise<OwnEntryRecord[]> {
    const entries = await this.prisma.raceEntry.findMany({
      where: { athleteId },
      orderBy: [{ raceDate: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        raceDate: true,
        division: true,
        verificationStatus: true,
        race: { select: { name: true, timezone: true } },
        raceResult: { select: { status: true } },
      },
    });

    return entries.map((entry) => ({
      raceEntryId: entry.id as RaceEntryId,
      raceName: entry.race.name,
      raceDate: entry.raceDate,
      timezone: entry.race.timezone,
      division: entry.division,
      bibVerificationStatus: entry.verificationStatus,
      resultStatus: entry.raceResult?.status ?? null,
    }));
  }
}
