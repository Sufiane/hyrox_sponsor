import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { BidderToken } from '../common/bidder-token';
import { InvalidValueError } from '../common/domain-error';
import { DomainErrorFilter } from '../common/domain-error.filter';
import { applyTrustProxy } from '../common/trust-proxy';
import { createValidationPipe } from '../common/validation-pipe';
import { BidderController } from './bidder.controller';
import { BidderService } from './bidder.service';

const WINDOW_MS = 60_000;
const GLOBAL_LIMIT = 60;
const SETUP_LIMIT = 10;

const setupResult = {
  clientSecret: 'seti_secret',
  bidderToken: 'signed.token' as BidderToken,
  bidderTokenExpiresAt: new Date('2026-11-16T12:00:00.000Z'),
};

async function startApp(
  createPaymentSetup: ReturnType<typeof vi.fn>,
): Promise<{ app: NestExpressApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: WINDOW_MS, limit: GLOBAL_LIMIT }])],
    controllers: [BidderController],
    providers: [
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: BidderService, useValue: { createPaymentSetup } },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();

  app.useGlobalFilters(new DomainErrorFilter());
  app.useGlobalPipes(createValidationPipe());
  applyTrustProxy(app, 1);
  await app.listen(0);

  return { app, baseUrl: await app.getUrl() };
}

function post(baseUrl: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/bidders/setup-intents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.1', ...headers },
    body: JSON.stringify(body),
  });
}

async function postMany(baseUrl: string, forwardedFor: string, count: number): Promise<number[]> {
  const statuses: number[] = [];

  for (let i = 0; i < count; i++) {
    const response = await post(baseUrl, { email: 'jamie@x.com' }, { 'X-Forwarded-For': forwardedFor });

    statuses.push(response.status);
  }

  return statuses;
}

describe('BidderController', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let createPaymentSetup: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createPaymentSetup = vi.fn().mockResolvedValue(setupResult);
    ({ app, baseUrl } = await startApp(createPaymentSetup));
  });

  afterEach(async () => {
    await app.close();
  });

  describe('when the request is valid', () => {
    it('returns 201 with the response shape and no-store', async () => {
      const response = await post(baseUrl, { email: 'jamie@x.com' }, { 'X-Bidder-Token': 'raw.token.value' });

      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        clientSecret: 'seti_secret',
        bidderToken: 'signed.token',
        bidderTokenExpiresAt: '2026-11-16T12:00:00.000Z',
      });
      expect(createPaymentSetup).toHaveBeenCalledWith({ email: 'jamie@x.com', bidderToken: 'raw.token.value' });
    });
  });

  describe('when no token header is sent', () => {
    it('passes an undefined token to the service', async () => {
      await post(baseUrl, { email: 'jamie@x.com' });

      expect(createPaymentSetup).toHaveBeenCalledWith({ email: 'jamie@x.com', bidderToken: undefined });
    });
  });

  describe('when the body has an unknown field', () => {
    it('returns 400 validation_failed without calling the service', async () => {
      const response = await post(baseUrl, { email: 'jamie@x.com', bidderId: 'bidder-1' });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ message: 'validation_failed' });
      expect(createPaymentSetup).not.toHaveBeenCalled();
    });
  });

  describe('when the email is not an email', () => {
    it('returns 400 validation_failed', async () => {
      const response = await post(baseUrl, { email: 'nope' });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ message: 'validation_failed' });
    });
  });

  describe('when the service rejects with bidder_token_required', () => {
    beforeEach(() => {
      createPaymentSetup.mockRejectedValue(new UnauthorizedException('bidder_token_required'));
    });

    it('returns 401 with the code', async () => {
      const response = await post(baseUrl, { email: 'jamie@x.com' });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ message: 'bidder_token_required' });
    });
  });

  describe('when the service rejects with email_invalid', () => {
    beforeEach(() => {
      createPaymentSetup.mockRejectedValue(new InvalidValueError('email_invalid'));
    });

    it('returns 400 with the code', async () => {
      const response = await post(baseUrl, { email: 'jamie@x.com' });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ message: 'email_invalid' });
    });
  });

  describe('when the service rejects with bidder_stripe_customer_conflict', () => {
    beforeEach(() => {
      createPaymentSetup.mockRejectedValue(new ConflictException('bidder_stripe_customer_conflict'));
    });

    it('returns 409 with the code', async () => {
      const response = await post(baseUrl, { email: 'jamie@x.com' });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ message: 'bidder_stripe_customer_conflict' });
    });
  });

  describe('when the service rejects with bidder_not_found', () => {
    beforeEach(() => {
      createPaymentSetup.mockRejectedValue(new NotFoundException('bidder_not_found'));
    });

    it('returns 404 with the code', async () => {
      const response = await post(baseUrl, { email: 'jamie@x.com' });

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ message: 'bidder_not_found' });
    });
  });

  describe('when one client sends eleven requests in a minute', () => {
    it('accepts the first ten and throttles the eleventh', async () => {
      const statuses = await postMany(baseUrl, '203.0.113.1', SETUP_LIMIT + 1);

      expect(statuses.slice(0, SETUP_LIMIT)).toEqual(Array(SETUP_LIMIT).fill(201));
      expect(statuses[SETUP_LIMIT]).toBe(429);
    });
  });

  describe('when two clients behind one trusted hop each send ten requests', () => {
    it('gives each client its own bucket', async () => {
      const first = await postMany(baseUrl, '203.0.113.1', SETUP_LIMIT);
      const second = await postMany(baseUrl, '203.0.113.2', SETUP_LIMIT);

      expect([...first, ...second]).toEqual(Array(SETUP_LIMIT * 2).fill(201));
    });
  });
});
