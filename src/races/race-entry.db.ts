import { Injectable } from '@nestjs/common';
import { RaceEntry } from '@prisma/client';
import { documentKey, type DocumentKey } from '../common/document-key';
import type { AthleteId, RaceEntryId, RaceId } from '../common/ids';
import { PrismaService } from '../prisma/prisma.service';

export type RaceEntryRecord = Omit<RaceEntry, 'id' | 'athleteId' | 'verificationDocumentKey'> & {
  id: RaceEntryId;
  athleteId: AthleteId;
  verificationDocumentKey: DocumentKey | null;
};

export type AwaitingReviewRecord = {
  raceEntryId: RaceEntryId;
  athleteId: AthleteId;
  athleteName: string;
  raceId: RaceId;
  raceName: string;
  raceDate: Date;
  bibNumber: string | null;
  documentKey: DocumentKey;
  submittedAt: Date;
};

@Injectable()
export class RaceEntryDb {
  constructor(private readonly prisma: PrismaService) {}

  findByAthleteAndRace(athleteId: AthleteId, raceId: RaceId): Promise<RaceEntry | null> {
    return this.prisma.raceEntry.findFirst({ where: { athleteId, raceId } });
  }

  async findById(id: RaceEntryId): Promise<RaceEntryRecord | null> {
    const entry = await this.prisma.raceEntry.findUnique({ where: { id } });

    if (!entry) {
      return null;
    }

    return {
      ...entry,
      id: entry.id as RaceEntryId,
      athleteId: entry.athleteId as AthleteId,
      verificationDocumentKey:
        entry.verificationDocumentKey == null ? null : documentKey(entry.verificationDocumentKey),
    };
  }

  async findDocumentKeyById(id: RaceEntryId): Promise<{ documentKey: DocumentKey | null } | null> {
    const entry = await this.prisma.raceEntry.findUnique({
      where: { id },
      select: { verificationDocumentKey: true },
    });

    if (!entry) {
      return null;
    }

    const stored = entry.verificationDocumentKey;

    return { documentKey: stored == null ? null : documentKey(stored) };
  }

  async listAwaitingReview(limit: number): Promise<AwaitingReviewRecord[]> {
    const entries = await this.prisma.raceEntry.findMany({
      where: {
        verificationStatus: 'PENDING',
        verificationDocumentKey: { not: null },
        verificationSubmittedAt: { not: null },
      },
      orderBy: { verificationSubmittedAt: 'asc' },
      take: limit,
      include: {
        athlete: { select: { id: true, name: true } },
        race: { select: { id: true, name: true } },
      },
    });

    return entries.map((entry) => ({
      raceEntryId: entry.id as RaceEntryId,
      athleteId: entry.athlete.id as AthleteId,
      athleteName: entry.athlete.name,
      raceId: entry.race.id as RaceId,
      raceName: entry.race.name,
      raceDate: entry.raceDate,
      bibNumber: entry.bibNumber,
      documentKey: documentKey(this.required(entry.verificationDocumentKey)),
      submittedAt: this.required(entry.verificationSubmittedAt),
    }));
  }

  private required<T>(value: T | null): T {
    if (value == null) {
      throw new Error('awaiting_review_query_invariant_violated');
    }

    return value;
  }
}
