import { Logger } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { InvalidValueError, NotFoundError } from '../common/domain-error';
import type { RaceId } from '../common/ids';
import type { Seconds } from '../common/seconds';
import { PublicResultsDb, type PublicRaceListRecord, type PublicResultRow } from './public-results.db';
import { PublicResultsService } from './public-results.service';
import { decodeRaceCursor } from './race-cursor';

const race = 'race1' as RaceId;
const division = 'SINGLE_OPEN_MEN';
const raceRecord = {
  id: race,
  name: 'Hyrox Chicago',
  location: 'Chicago',
  date: new Date('2026-09-01T10:00:00Z'),
  timezone: 'America/Chicago',
};

function row(name: string, time: number): PublicResultRow {
  return { athleteName: name, finishTimeSeconds: time as Seconds };
}

function listRecord(id: string, day: number): PublicRaceListRecord {
  return {
    ...raceRecord,
    id: id as RaceId,
    date: new Date(Date.UTC(2026, 8, day)),
    resultCount: 2,
    verifiedCount: 1,
  };
}

describe('PublicResultsService', () => {
  let db: DeepMockProxy<PublicResultsDb>;
  let service: PublicResultsService;
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db = mockDeep<PublicResultsDb>();
    service = new PublicResultsService(db);
    db.findRace.mockResolvedValue(raceRecord);
    db.countByStatus.mockResolvedValue({ verified: 0, pending: 0 });
    db.listVerified.mockResolvedValue([]);
    db.listUnverified.mockResolvedValue([]);
    db.countVerifiedFasterThan.mockResolvedValue(0);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('listRaces', () => {
    describe('when there are more races than the limit', () => {
      beforeEach(() => {
        db.listRaces.mockResolvedValue([listRecord('r3', 3), listRecord('r2', 2), listRecord('r1', 1)]);
      });

      it('asks for one extra row, trims it and returns a cursor for the last item', async () => {
        const page = await service.listRaces(2, null);

        expect(db.listRaces).toHaveBeenCalledWith(3, null);
        expect(page.items.map((item) => item.id)).toEqual(['r3', 'r2']);
        expect(decodeRaceCursor(page.nextCursor as string)).toEqual({
          date: new Date(Date.UTC(2026, 8, 2)),
          id: 'r2',
        });
      });
    });

    describe('when the page holds exactly the limit', () => {
      it('returns no cursor', async () => {
        db.listRaces.mockResolvedValue([listRecord('r2', 2), listRecord('r1', 1)]);

        const page = await service.listRaces(2, null);

        expect(page.items).toHaveLength(2);
        expect(page.nextCursor).toBeNull();
      });
    });

    describe('when there are no races', () => {
      it('returns an empty page', async () => {
        db.listRaces.mockResolvedValue([]);

        await expect(service.listRaces(20, null)).resolves.toEqual({ items: [], nextCursor: null });
      });
    });

    describe('when a cursor is supplied', () => {
      it('decodes it for the db', async () => {
        db.listRaces.mockResolvedValue([listRecord('r3', 3), listRecord('r2', 2)]);
        const first = await service.listRaces(1, null);

        db.listRaces.mockResolvedValue([]);
        await service.listRaces(1, first.nextCursor);

        expect(db.listRaces).toHaveBeenLastCalledWith(2, { date: new Date(Date.UTC(2026, 8, 3)), id: 'r3' });
      });
    });

    describe('when the cursor is garbage', () => {
      it('throws cursor_invalid', async () => {
        await expect(service.listRaces(20, '!!!')).rejects.toThrow(InvalidValueError);
        await expect(service.listRaces(20, '!!!')).rejects.toThrow('cursor_invalid');
      });
    });
  });

  describe('getRace', () => {
    describe('when the race has no public result', () => {
      it('throws race_not_found', async () => {
        db.findRace.mockResolvedValue(null);

        await expect(service.getRace(race)).rejects.toThrow(NotFoundError);
        await expect(service.getRace(race)).rejects.toThrow('race_not_found');
        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the race has public results', () => {
      it('returns the race with divisions in canonical order', async () => {
        db.listDivisionCounts.mockResolvedValue([
          { division: 'RELAY_MEN', resultCount: 1, verifiedCount: 0 },
          { division: 'SINGLE_OPEN_MEN', resultCount: 4, verifiedCount: 2 },
        ]);

        await expect(service.getRace(race)).resolves.toEqual({
          ...raceRecord,
          divisions: [
            { division: 'SINGLE_OPEN_MEN', resultCount: 4, verifiedCount: 2 },
            { division: 'RELAY_MEN', resultCount: 1, verifiedCount: 0 },
          ],
        });
      });
    });
  });

  describe('listResults', () => {
    describe('when the race has no public result', () => {
      it('throws race_not_found', async () => {
        db.findRace.mockResolvedValue(null);

        await expect(service.listResults(race, division, 50, 0)).rejects.toThrow('race_not_found');
      });
    });

    describe('when the division has no results', () => {
      it('returns an empty page', async () => {
        await expect(service.listResults(race, division, 50, 0)).resolves.toEqual({
          items: [],
          total: 0,
          verifiedTotal: 0,
        });
        expect(db.countVerifiedFasterThan).not.toHaveBeenCalled();
      });
    });

    describe('when verified times tie', () => {
      beforeEach(() => {
        db.countByStatus.mockResolvedValue({ verified: 4, pending: 0 });
        db.listVerified.mockResolvedValue([row('Ann A', 3_000), row('Bob B', 3_100), row('Cy C', 3_100), row('Di D', 3_200)]);
      });

      it('uses competition ranking', async () => {
        const page = await service.listResults(race, division, 50, 0);

        expect(page.items.map((item) => item.rank)).toEqual([1, 2, 2, 4]);
        expect(page.items.every((item) => item.verified)).toBe(true);
      });
    });

    describe('when a tie spans a page boundary', () => {
      beforeEach(() => {
        db.countByStatus.mockResolvedValue({ verified: 4, pending: 0 });
        db.listVerified.mockResolvedValue([row('Cy C', 3_100), row('Di D', 3_200)]);
        db.countVerifiedFasterThan.mockResolvedValue(1);
      });

      it('ranks the first row from the db count', async () => {
        const page = await service.listResults(race, division, 2, 2);

        expect(db.countVerifiedFasterThan).toHaveBeenCalledWith(race, division, 3_100);
        expect(page.items.map((item) => item.rank)).toEqual([2, 4]);
      });
    });

    describe('when the page is entirely in the unverified region', () => {
      beforeEach(() => {
        db.countByStatus.mockResolvedValue({ verified: 3, pending: 4 });
        db.listUnverified.mockResolvedValue([row('Eve E', 3_500), row('Fay F', 3_600)]);
      });

      it('skips the verified query and offsets into the unverified list', async () => {
        const page = await service.listResults(race, division, 2, 4);

        expect(db.listVerified).not.toHaveBeenCalled();
        expect(db.countVerifiedFasterThan).not.toHaveBeenCalled();
        expect(db.listUnverified).toHaveBeenCalledWith(race, division, 1, 2);
        expect(page.items).toEqual([
          { rank: null, displayName: 'Eve E.', finishTimeSeconds: 3_500, verified: false },
          { rank: null, displayName: 'Fay F.', finishTimeSeconds: 3_600, verified: false },
        ]);
        expect(page.total).toBe(7);
        expect(page.verifiedTotal).toBe(3);
      });
    });

    describe('when the page straddles verified and unverified', () => {
      beforeEach(() => {
        db.countByStatus.mockResolvedValue({ verified: 3, pending: 4 });
        db.listVerified.mockResolvedValue([row('Cy C', 3_100)]);
        db.countVerifiedFasterThan.mockResolvedValue(2);
        db.listUnverified.mockResolvedValue([row('Eve E', 3_500), row('Fay F', 3_600)]);
      });

      it('lists the verified tail then unverified from the start', async () => {
        const page = await service.listResults(race, division, 3, 2);

        expect(db.listVerified).toHaveBeenCalledWith(race, division, 2, 1);
        expect(db.listUnverified).toHaveBeenCalledWith(race, division, 0, 2);
        expect(page.items.map((item) => [item.rank, item.verified])).toEqual([
          [3, true],
          [null, false],
          [null, false],
        ]);
      });
    });

    describe('when there are no verified results', () => {
      beforeEach(() => {
        db.countByStatus.mockResolvedValue({ verified: 0, pending: 2 });
        db.listUnverified.mockResolvedValue([row('Eve E', 3_500), row('Fay F', 3_600)]);
      });

      it('lists the unverified rows unranked', async () => {
        const page = await service.listResults(race, division, 50, 0);

        expect(db.listUnverified).toHaveBeenCalledWith(race, division, 0, 50);
        expect(page.items.map((item) => item.rank)).toEqual([null, null]);
        expect(page.verifiedTotal).toBe(0);
      });
    });

    describe('when the verified page fills the limit', () => {
      beforeEach(() => {
        db.countByStatus.mockResolvedValue({ verified: 2, pending: 3 });
        db.listVerified.mockResolvedValue([row('Ann A', 3_000), row('Bob B', 3_100)]);
      });

      it('does not query unverified rows', async () => {
        await service.listResults(race, division, 2, 0);

        expect(db.listUnverified).not.toHaveBeenCalled();
      });
    });

    describe('when rows are mapped', () => {
      beforeEach(() => {
        db.countByStatus.mockResolvedValue({ verified: 1, pending: 0 });
        db.listVerified.mockResolvedValue([row('Jane Marie Doe', 3_000)]);
      });

      it('exposes only the first name and last initial', async () => {
        const page = await service.listResults(race, division, 50, 0);

        expect(page.items[0]).toEqual({ rank: 1, displayName: 'Jane D.', finishTimeSeconds: 3_000, verified: true });
      });
    });
  });
});
