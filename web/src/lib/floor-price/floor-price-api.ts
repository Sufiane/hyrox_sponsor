import type { BodyZone } from '@hyrox-sponsor/shared/body-zone';
import { errorCode } from '../auth/error-code.ts';

export interface FloorPriceView {
  zone: BodyZone;
  floorPriceCents: number;
  isDefault: boolean;
}

export class FloorPriceApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'FloorPriceApiError';
  }
}

export interface FloorPriceApiOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface FloorPriceApi {
  getFloorPrices(): Promise<FloorPriceView[]>;
  saveFloorPrice(zone: BodyZone, floorPriceCents: number): Promise<FloorPriceView>;
}

async function send(
  options: FloorPriceApiOptions,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl}${path}`, init);

  if (!response.ok) {
    throw new FloorPriceApiError(response.status, await errorCode(response));
  }

  return response.json();
}

export function createFloorPriceApi(options: FloorPriceApiOptions): FloorPriceApi {
  return {
    async getFloorPrices(): Promise<FloorPriceView[]> {
      const body = (await send(options, '/zone-floor-prices', {
        method: 'GET',
      })) as {
        prices: FloorPriceView[];
      };

      return body.prices;
    },

    async saveFloorPrice(zone: BodyZone, floorPriceCents: number): Promise<FloorPriceView> {
      const body = await send(options, `/zone-floor-prices/${zone}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floorPriceCents }),
      });

      return body as FloorPriceView;
    },
  };
}
