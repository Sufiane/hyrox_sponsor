import { Controller, HttpCode, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { applyTrustProxy } from '../common/trust-proxy';

const PROBE_LIMIT = 2;
const WINDOW_MS = 60_000;
const GLOBAL_LIMIT = 60;

@Controller('probe')
class ProbeController {
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: PROBE_LIMIT, ttl: WINDOW_MS } })
  probe(): { ok: true } {
    return { ok: true };
  }
}

async function startApp(
  hops: number,
): Promise<{ app: NestExpressApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: WINDOW_MS, limit: GLOBAL_LIMIT }])],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();

  applyTrustProxy(app, hops);
  await app.listen(0);

  return { app, baseUrl: await app.getUrl() };
}

async function post(baseUrl: string, forwardedFor: string): Promise<number> {
  const response = await fetch(`${baseUrl}/probe`, {
    method: 'POST',
    headers: { 'X-Forwarded-For': forwardedFor },
  });

  return response.status;
}

async function postAll(baseUrl: string, forwardedFor: string[]): Promise<number[]> {
  const statuses: number[] = [];

  for (const header of forwardedFor) {
    statuses.push(await post(baseUrl, header));
  }

  return statuses;
}

describe('auth throttle keying', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  afterEach(async () => {
    await app.close();
  });

  describe('when one trusted hop and clients send different X-Forwarded-For values', () => {
    beforeEach(async () => {
      ({ app, baseUrl } = await startApp(1));
    });

    it('gives each client its own bucket', async () => {
      const first = await postAll(baseUrl, ['203.0.113.1', '203.0.113.1']);
      const second = await postAll(baseUrl, ['203.0.113.2', '203.0.113.2']);

      expect([...first, ...second]).toEqual([200, 200, 200, 200]);
    });

    it('rejects the third call from the same client', async () => {
      const statuses = await postAll(baseUrl, ['203.0.113.1', '203.0.113.1', '203.0.113.1']);

      expect(statuses).toEqual([200, 200, 429]);
    });
  });

  describe('when one trusted hop and the client forges extra leftmost entries', () => {
    beforeEach(async () => {
      ({ app, baseUrl } = await startApp(1));
    });

    it('still throttles on the rightmost entry', async () => {
      const statuses = await postAll(baseUrl, [
        'forged-a, 203.0.113.9',
        'forged-b, 203.0.113.9',
        'forged-c, 203.0.113.9',
      ]);

      expect(statuses).toEqual([200, 200, 429]);
    });
  });

  describe('when no hops are trusted', () => {
    beforeEach(async () => {
      ({ app, baseUrl } = await startApp(0));
    });

    it('ignores X-Forwarded-For and shares one bucket', async () => {
      const statuses = await postAll(baseUrl, ['203.0.113.1', '203.0.113.2', '203.0.113.3']);

      expect(statuses).toEqual([200, 200, 429]);
    });
  });
});
