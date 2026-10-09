import type { Mock } from 'vitest';
import { createFloorPriceApi, FloorPriceApiError } from './floor-price-api.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createFloorPriceApi', () => {
  let fetchImpl: Mock<typeof fetch>;

  function build(): ReturnType<typeof createFloorPriceApi> {
    return createFloorPriceApi({
      baseUrl: 'http://api.test',
      fetchImpl,
    });
  }

  beforeEach(() => {
    fetchImpl = vi.fn<typeof fetch>();
  });

  describe('getFloorPrices', () => {
    const prices = [{ zone: 'LEFT_PEC', floorPriceCents: 2500, isDefault: false }];

    beforeEach(() => {
      fetchImpl.mockResolvedValue(jsonResponse({ prices }));
    });

    it('sends a GET', async () => {
      await build().getFloorPrices();

      expect(fetchImpl).toHaveBeenCalledWith('http://api.test/zone-floor-prices', {
        method: 'GET',
      });
    });

    it('returns the prices', async () => {
      await expect(build().getFloorPrices()).resolves.toEqual(prices);
    });
  });

  describe('saveFloorPrice', () => {
    const saved = { zone: 'LEFT_PEC', floorPriceCents: 2500, isDefault: false };

    beforeEach(() => {
      fetchImpl.mockResolvedValue(jsonResponse(saved));
    });

    it('sends a PUT with the cents body', async () => {
      await build().saveFloorPrice('LEFT_PEC', 2500);

      expect(fetchImpl).toHaveBeenCalledWith('http://api.test/zone-floor-prices/LEFT_PEC', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floorPriceCents: 2500 }),
      });
    });

    it('returns the saved entry', async () => {
      await expect(build().saveFloorPrice('LEFT_PEC', 2500)).resolves.toEqual(saved);
    });
  });

  describe('when the server rejects with a message code', () => {
    beforeEach(() => {
      fetchImpl.mockResolvedValue(
        jsonResponse({ statusCode: 400, message: 'floor_price_below_minimum' }, 400),
      );
    });

    it('rejects with the status and code', async () => {
      const error = await build()
        .saveFloorPrice('LEFT_PEC', 900)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(FloorPriceApiError);
      expect(error).toMatchObject({
        status: 400,
        code: 'floor_price_below_minimum',
      });
    });
  });

  describe('when the error body is not JSON', () => {
    beforeEach(() => {
      fetchImpl.mockResolvedValue(new Response('<html>oops</html>', { status: 502 }));
    });

    it('falls back to request_failed', async () => {
      await expect(build().getFloorPrices()).rejects.toMatchObject({
        status: 502,
        code: 'request_failed',
      });
    });
  });
});
