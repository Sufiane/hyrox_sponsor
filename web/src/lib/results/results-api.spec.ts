import type { Mock } from 'vitest';
import { createResultsApi } from './results-api.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('createResultsApi', () => {
  let fetchImpl: Mock<typeof fetch>;

  function api(): ReturnType<typeof createResultsApi> {
    return createResultsApi({ baseUrl: 'http://api.test', fetchImpl });
  }

  beforeEach(() => {
    fetchImpl = vi.fn<typeof fetch>();
  });

  describe('listRaces', () => {
    it('returns the parsed list', async () => {
      const body = { items: [], nextCursor: null };
      fetchImpl.mockResolvedValue(jsonResponse(body));

      expect(await api().listRaces()).toEqual({ ok: true, value: body });
      expect(fetchImpl).toHaveBeenCalledWith('http://api.test/public/races', { method: 'GET' });
    });

    it('encodes the cursor', async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));

      await api().listRaces('a b&c=d');

      expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/public/races?cursor=a%20b%26c%3Dd');
    });
  });

  describe('getRace', () => {
    it('encodes the race id', async () => {
      fetchImpl.mockResolvedValue(jsonResponse({}));

      await api().getRace('../x');

      expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/public/races/..%2Fx');
    });

    describe('when the race is missing', () => {
      it('returns the error code', async () => {
        fetchImpl.mockResolvedValue(jsonResponse({ message: 'race_not_found' }, 404));

        expect(await api().getRace('r1')).toEqual({
          ok: false,
          status: 404,
          code: 'race_not_found',
        });
      });
    });
  });

  describe('listResults', () => {
    it('maps the page to limit and offset', async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ items: [], total: 0, verifiedTotal: 0 }));

      await api().listResults('r1', { division: 'SINGLE_PRO_MEN', page: 3 });

      expect(fetchImpl.mock.calls[0][0]).toBe(
        'http://api.test/public/races/r1/results?division=SINGLE_PRO_MEN&limit=50&offset=100',
      );
    });
  });

  describe('when fetch throws', () => {
    it('returns a 502 request_failed', async () => {
      fetchImpl.mockRejectedValue(new TypeError('network'));

      expect(await api().getRace('r1')).toEqual({
        ok: false,
        status: 502,
        code: 'request_failed',
      });
    });
  });

  describe('when the body is not json', () => {
    it('returns a 502 request_failed', async () => {
      fetchImpl.mockResolvedValue(new Response('<html>', { status: 200 }));

      expect(await api().getRace('r1')).toMatchObject({ ok: false, status: 502 });
    });
  });
});
