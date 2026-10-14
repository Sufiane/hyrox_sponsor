import type { ResultsApi } from './results-api.ts';
import { loadRaceList, loadRacePage, pickDivision, parsePage } from './results-loaders.ts';
import type { PublicRaceDetail } from './results-types.ts';

const RACE: PublicRaceDetail = {
  id: 'r1',
  name: 'Hyrox Berlin',
  location: 'Berlin',
  date: '2026-10-10T08:00:00.000Z',
  timezone: 'Europe/Berlin',
  divisions: [
    { division: 'SINGLE_OPEN_MEN', resultCount: 3, verifiedCount: 2 },
    { division: 'RELAY_MIXED', resultCount: 1, verifiedCount: 1 },
  ],
};

const PAGE = { items: [], total: 3, verifiedTotal: 2 };

function fakeApi(overrides: Partial<ResultsApi> = {}): ResultsApi {
  return {
    listRaces: vi.fn().mockResolvedValue({ ok: true, value: { items: [], nextCursor: 'n' } }),
    getRace: vi.fn().mockResolvedValue({ ok: true, value: RACE }),
    listResults: vi.fn().mockResolvedValue({ ok: true, value: PAGE }),
    ...overrides,
  };
}

function url(query: string): URL {
  return new URL(`http://web.test/results/r1${query}`);
}

async function status(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (thrown) {
    return (thrown as { status: number }).status;
  }

  return 0;
}

describe('parsePage', () => {
  it.each([
    [null, 1],
    ['abc', 1],
    ['0', 1],
    ['-3', 1],
    ['2.5', 1],
    ['3', 3],
    ['999999', 201],
  ])('parses %s as %s', (raw, expected) => {
    expect(parsePage(raw)).toBe(expected);
  });
});

describe('pickDivision', () => {
  it('keeps a division the race has', () => {
    expect(pickDivision('RELAY_MIXED', RACE)).toBe('RELAY_MIXED');
  });

  it('falls back to the first division when unknown', () => {
    expect(pickDivision('NOPE', RACE)).toBe('SINGLE_OPEN_MEN');
  });

  it('falls back to the first division when missing', () => {
    expect(pickDivision(null, RACE)).toBe('SINGLE_OPEN_MEN');
  });

  it('returns null when the race has no divisions', () => {
    expect(pickDivision(null, { ...RACE, divisions: [] })).toBeNull();
  });
});

describe('loadRaceList', () => {
  it('forwards the cursor and returns the list', async () => {
    const api = fakeApi();

    const data = await loadRaceList(api, new URL('http://web.test/results?cursor=abc'));

    expect(api.listRaces).toHaveBeenCalledWith('abc');
    expect(data).toEqual({ races: [], nextCursor: 'n' });
  });

  describe('when the backend fails', () => {
    it('answers 502', async () => {
      const api = fakeApi({
        listRaces: vi.fn().mockResolvedValue({ ok: false, status: 500, code: 'x' }),
      });

      expect(await status(loadRaceList(api, new URL('http://web.test/results')))).toBe(502);
    });
  });
});

describe('loadRacePage', () => {
  it('loads the selected division and page', async () => {
    const api = fakeApi();

    const data = await loadRacePage(api, 'r1', url('?division=RELAY_MIXED&page=2'));

    expect(api.listResults).toHaveBeenCalledWith('r1', { division: 'RELAY_MIXED', page: 2 });
    expect(data).toEqual({ race: RACE, division: 'RELAY_MIXED', page: 2, results: PAGE });
  });

  describe('when the division is unknown', () => {
    it('uses the first division', async () => {
      const api = fakeApi();

      await loadRacePage(api, 'r1', url('?division=%3Cscript%3E'));

      expect(api.listResults).toHaveBeenCalledWith('r1', {
        division: 'SINGLE_OPEN_MEN',
        page: 1,
      });
    });
  });

  describe('when the race is missing', () => {
    it('answers 404', async () => {
      const api = fakeApi({
        getRace: vi.fn().mockResolvedValue({ ok: false, status: 404, code: 'race_not_found' }),
      });

      expect(await status(loadRacePage(api, 'r1', url('')))).toBe(404);
    });
  });

  describe('when the race id is malformed', () => {
    it('answers 404', async () => {
      const api = fakeApi({
        getRace: vi.fn().mockResolvedValue({ ok: false, status: 400, code: 'invalid_id' }),
      });

      expect(await status(loadRacePage(api, 'submit', url('')))).toBe(404);
    });
  });

  describe('when the results call fails', () => {
    it('answers 502 without backend detail', async () => {
      const api = fakeApi({
        listResults: vi.fn().mockResolvedValue({ ok: false, status: 500, code: 'secret_detail' }),
      });

      let message = '';

      try {
        await loadRacePage(api, 'r1', url(''));
      } catch (thrown) {
        message = JSON.stringify(thrown);
      }

      expect(message).not.toContain('secret_detail');
      expect(await status(loadRacePage(api, 'r1', url('')))).toBe(502);
    });
  });
});
