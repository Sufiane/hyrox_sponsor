import type { BodyZone } from '@hyrox-sponsor/shared/body-zone';

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
  getAccessToken: () => string | null;
  fetchImpl?: typeof fetch;
}

export interface FloorPriceApi {
  getFloorPrices(): Promise<FloorPriceView[]>;
  saveFloorPrice(zone: BodyZone, floorPriceCents: number): Promise<FloorPriceView>;
}

const GENERIC_CODE = 'request_failed';

async function errorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { message?: unknown }).message;

    return typeof message === 'string' ? message : GENERIC_CODE;
  } catch {
    return GENERIC_CODE;
  }
}

async function send(
  options: FloorPriceApiOptions,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const token = options.getAccessToken();

  if (token == null || token === '') {
    throw new FloorPriceApiError(401, 'not_authenticated');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });

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
