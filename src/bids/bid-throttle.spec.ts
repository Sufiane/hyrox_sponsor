import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DomainErrorFilter } from '../common/domain-error.filter';
import type { AuctionId, BidderId, BidId } from '../common/ids';
import { cents } from '../common/money';
import { applyTrustProxy } from '../common/trust-proxy';
import { createValidationPipe } from '../common/validation-pipe';
import { BidController } from './bid.controller';
import { BidService } from './bid.service';
import type { PlaceBidResult } from './usecases/place-bid/place-bid.usecase';

const WINDOW_MS = 60_000;
const GLOBAL_LIMIT = 60;
const BID_LIMIT = 10;

const placeBidResult: PlaceBidResult = {
  bid: {
    id: 'bid-1' as BidId,
    auctionId: 'auc-1' as AuctionId,
    bidderId: 'bidder-1' as BidderId,
    amountCents: cents(5_500),
    placedAt: new Date('2026-11-08T12:00:00Z'),
  },
  closeAt: new Date('2026-11-09T06:00:00Z'),
  previousLeader: null,
};

async function startApp(hops: number): Promise<{ app: NestExpressApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: WINDOW_MS, limit: GLOBAL_LIMIT }])],
    controllers: [BidController],
    providers: [
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: BidService, useValue: { placeBid: vi.fn().mockResolvedValue(placeBidResult) } },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();

  app.useGlobalFilters(new DomainErrorFilter());
  app.useGlobalPipes(createValidationPipe());
  applyTrustProxy(app, hops);
  await app.listen(0);

  return { app, baseUrl: await app.getUrl() };
}

async function postBid(baseUrl: string, forwardedFor: string): Promise<number> {
  const response = await fetch(`${baseUrl}/auctions/auc-1/bids`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwardedFor },
    body: JSON.stringify({ email: 'jamie@x.com', amountCents: 5_500 }),
  });

  return response.status;
}

async function postMany(baseUrl: string, forwardedFor: string, count: number): Promise<number[]> {
  const statuses: number[] = [];

  for (let i = 0; i < count; i++) {
    statuses.push(await postBid(baseUrl, forwardedFor));
  }

  return statuses;
}

describe('bid placement throttle', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeEach(async () => {
    ({ app, baseUrl } = await startApp(1));
  });

  afterEach(async () => {
    await app.close();
  });

  describe('when one client sends eleven bids in a minute', () => {
    it('accepts the first ten and throttles the eleventh', async () => {
      const statuses = await postMany(baseUrl, '203.0.113.1', BID_LIMIT + 1);

      expect(statuses.slice(0, BID_LIMIT)).toEqual(Array(BID_LIMIT).fill(201));
      expect(statuses[BID_LIMIT]).toBe(429);
    });
  });

  describe('when two clients behind one trusted hop each send ten bids', () => {
    it('gives each client its own bucket', async () => {
      const first = await postMany(baseUrl, '203.0.113.1', BID_LIMIT);
      const second = await postMany(baseUrl, '203.0.113.2', BID_LIMIT);

      expect([...first, ...second]).toEqual(Array(BID_LIMIT * 2).fill(201));
    });
  });
});
