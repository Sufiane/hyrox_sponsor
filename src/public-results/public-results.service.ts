import { Injectable, Logger } from '@nestjs/common';
import { NotFoundError } from '../common/domain-error';
import type { RaceId } from '../common/ids';
import { DIVISION, type RaceDivisionCode } from '../races/race-division';
import { displayName } from './display-name';
import { PublicResultsDb, type PublicRaceRecord, type PublicResultRow } from './public-results.db';
import { decodeRaceCursor, encodeRaceCursor } from './race-cursor';

const DIVISION_ORDER: readonly string[] = Object.keys(DIVISION);

export type PublicRaceListItem = {
  id: RaceId;
  name: string;
  location: string;
  date: Date;
  timezone: string;
  resultCount: number;
  verifiedCount: number;
};

export type PublicRaceList = { items: PublicRaceListItem[]; nextCursor: string | null };

export type PublicRaceDetail = {
  id: RaceId;
  name: string;
  location: string;
  date: Date;
  timezone: string;
  divisions: { division: RaceDivisionCode; resultCount: number; verifiedCount: number }[];
};

export type PublicResultItem = {
  rank: number | null;
  displayName: string;
  finishTimeSeconds: number;
  verified: boolean;
};

export type PublicResultPage = { items: PublicResultItem[]; total: number; verifiedTotal: number };

@Injectable()
export class PublicResultsService {
  private readonly logger = new Logger(PublicResultsService.name);

  constructor(private readonly db: PublicResultsDb) {}

  async listRaces(limit: number, cursor: string | null): Promise<PublicRaceList> {
    const after = cursor == null ? null : decodeRaceCursor(cursor);
    const rows = await this.db.listRaces(limit + 1, after);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items,
      nextCursor: rows.length > limit && last ? encodeRaceCursor({ date: last.date, id: last.id }) : null,
    };
  }

  async getRace(id: RaceId): Promise<PublicRaceDetail> {
    const race = await this.requireRace(id);
    const counts = await this.db.listDivisionCounts(id);
    const divisions = [...counts].sort(
      (first, second) => DIVISION_ORDER.indexOf(first.division) - DIVISION_ORDER.indexOf(second.division),
    );

    return { ...race, divisions };
  }

  async listResults(
    id: RaceId,
    division: RaceDivisionCode,
    limit: number,
    offset: number,
  ): Promise<PublicResultPage> {
    await this.requireRace(id);

    const { verified, pending } = await this.db.countByStatus(id, division);
    const verifiedRows = await this.verifiedPage(id, division, offset, limit, verified);
    const verifiedItems = await this.rankVerified(id, division, verifiedRows, offset);
    const remaining = limit - verifiedRows.length;
    const unverifiedRows =
      remaining > 0 && pending > 0
        ? await this.db.listUnverified(id, division, Math.max(0, offset - verified), remaining)
        : [];
    const unverifiedItems = unverifiedRows.map((row) => this.toItem(row, null, false));

    return { items: [...verifiedItems, ...unverifiedItems], total: verified + pending, verifiedTotal: verified };
  }

  private async requireRace(id: RaceId): Promise<PublicRaceRecord> {
    const race = await this.db.findRace(id);

    if (!race) {
      this.logger.warn(`Race ${id} not found or has no public results`);

      throw new NotFoundError('race_not_found');
    }

    return race;
  }

  private async verifiedPage(
    id: RaceId,
    division: RaceDivisionCode,
    offset: number,
    limit: number,
    verifiedTotal: number,
  ): Promise<PublicResultRow[]> {
    if (offset >= verifiedTotal) {
      return [];
    }

    return this.db.listVerified(id, division, offset, Math.min(limit, verifiedTotal - offset));
  }

  private async rankVerified(
    id: RaceId,
    division: RaceDivisionCode,
    rows: PublicResultRow[],
    offset: number,
  ): Promise<PublicResultItem[]> {
    if (rows.length === 0) {
      return [];
    }

    const faster = await this.db.countVerifiedFasterThan(id, division, rows[0].finishTimeSeconds);
    const items: PublicResultItem[] = [];
    let rank = faster + 1;

    for (let i = 0; i < rows.length; i++) {
      if (i > 0 && rows[i].finishTimeSeconds !== rows[i - 1].finishTimeSeconds) {
        rank = offset + i + 1;
      }

      items.push(this.toItem(rows[i], rank, true));
    }

    return items;
  }

  private toItem(row: PublicResultRow, rank: number | null, verified: boolean): PublicResultItem {
    return {
      rank,
      displayName: displayName(row.athleteName),
      finishTimeSeconds: row.finishTimeSeconds,
      verified,
    };
  }
}
