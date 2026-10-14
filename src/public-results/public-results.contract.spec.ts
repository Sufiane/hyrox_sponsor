import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { RaceId } from '../common/ids';
import type { Seconds } from '../common/seconds';
import { PublicResultsDb } from './public-results.db';
import { PublicResultsController } from './public-results.controller';
import { PublicResultsService } from './public-results.service';

const race = 'race1' as RaceId;
const forbiddenKey = /photo|proof|email|bib|athleteId|password|reviewed|rejection|submitted/i;

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectKeys(item));
  }

  if (value instanceof Date || value === null || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) => [key, ...collectKeys(nested)]);
}

describe('public results contract', () => {
  let db: DeepMockProxy<PublicResultsDb>;
  let controller: PublicResultsController;

  beforeEach(() => {
    db = mockDeep<PublicResultsDb>();
    controller = new PublicResultsController(new PublicResultsService(db));
    db.findRace.mockResolvedValue({
      id: race,
      name: 'Hyrox Chicago',
      location: 'Chicago',
      date: new Date('2026-09-01T10:00:00Z'),
      timezone: 'America/Chicago',
    });
  });

  it('lists races with exactly the public keys', async () => {
    db.listRaces.mockResolvedValue([
      {
        id: race,
        name: 'Hyrox Chicago',
        location: 'Chicago',
        date: new Date('2026-09-01T10:00:00Z'),
        timezone: 'America/Chicago',
        resultCount: 2,
        verifiedCount: 1,
      },
    ]);

    const body = await controller.listRaces({ limit: 20 });

    expect(Object.keys(body).sort()).toEqual(['items', 'nextCursor']);
    expect(Object.keys(body.items[0]).sort()).toEqual(
      ['date', 'id', 'location', 'name', 'resultCount', 'timezone', 'verifiedCount'].sort(),
    );
    expect(collectKeys(body).filter((key) => forbiddenKey.test(key))).toEqual([]);
  });

  it('returns race detail with exactly the public keys', async () => {
    db.listDivisionCounts.mockResolvedValue([{ division: 'RELAY_MEN', resultCount: 1, verifiedCount: 1 }]);

    const body = await controller.getRace({ raceId: race });

    expect(Object.keys(body).sort()).toEqual(['date', 'divisions', 'id', 'location', 'name', 'timezone']);
    expect(Object.keys(body.divisions[0]).sort()).toEqual(['division', 'resultCount', 'verifiedCount']);
    expect(collectKeys(body).filter((key) => forbiddenKey.test(key))).toEqual([]);
  });

  it('returns results with exactly the public keys and no ids', async () => {
    db.countByStatus.mockResolvedValue({ verified: 1, pending: 1 });
    db.listVerified.mockResolvedValue([{ athleteName: 'Jane Doe', finishTimeSeconds: 3_000 as Seconds }]);
    db.listUnverified.mockResolvedValue([{ athleteName: 'Bob Roe', finishTimeSeconds: 3_100 as Seconds }]);
    db.countVerifiedFasterThan.mockResolvedValue(0);

    const body = await controller.listResults(
      { raceId: race },
      { division: 'SINGLE_OPEN_MEN', limit: 50, offset: 0 },
    );

    expect(Object.keys(body).sort()).toEqual(['items', 'total', 'verifiedTotal']);

    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(['displayName', 'finishTimeSeconds', 'rank', 'verified']);
    }

    expect(collectKeys(body).filter((key) => forbiddenKey.test(key) || key === 'id')).toEqual([]);
  });

  it('carries no guard metadata on the controller or its routes', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PublicResultsController)).toBeUndefined();

    for (const route of [controller.listRaces, controller.getRace, controller.listResults]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, route)).toBeUndefined();
    }
  });

  it('marks every route cacheable for 60 seconds', () => {
    for (const route of [controller.listRaces, controller.getRace, controller.listResults]) {
      expect(Reflect.getMetadata(HEADERS_METADATA, route)).toEqual([
        { name: 'Cache-Control', value: 'public, max-age=60' },
      ]);
    }
  });
});
