import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConflictError, ForbiddenError, InvalidValueError, NotFoundError } from '../common/domain-error';
import { DomainErrorFilter } from '../common/domain-error.filter';
import type { AuctionId, BidderId, BidId } from '../common/ids';
import { cents } from '../common/money';
import { createValidationPipe } from '../common/validation-pipe';
import { BidController } from './bid.controller';
import { BidService } from './bid.service';
import type { PlaceBidResult } from './usecases/place-bid/place-bid.usecase';

type Reply = { status: number; json: Record<string, unknown> };

describe('BidController', () => {
  const placedAt = new Date('2026-11-08T12:00:00Z');
  const closeAt = new Date('2026-11-09T06:00:00Z');
  const placeBidResult: PlaceBidResult = {
    bid: {
      id: 'bid-2' as BidId,
      auctionId: 'auc-1' as AuctionId,
      bidderId: 'bidder-2' as BidderId,
      amountCents: cents(5_500),
      placedAt,
    },
    closeAt,
    previousLeader: { bidId: 'bid-1' as BidId, bidderId: 'bidder-1' as BidderId, amountCents: cents(5_000) },
  };
  let app: INestApplication;
  let baseUrl: string;
  let placeBid: ReturnType<typeof vi.fn>;

  async function postBid(body: unknown, auctionPath = 'auc-1'): Promise<Reply> {
    const response = await fetch(`${baseUrl}/auctions/${auctionPath}/bids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  beforeEach(async () => {
    placeBid = vi.fn();

    const moduleRef = await Test.createTestingModule({
      controllers: [BidController],
      providers: [{ provide: BidService, useValue: { placeBid } }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainErrorFilter());
    app.useGlobalPipes(createValidationPipe());
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('when the usecase succeeds', () => {
    beforeEach(() => {
      placeBid.mockResolvedValue(placeBidResult);
    });

    it('responds 201 with the mapped bid', async () => {
      const reply = await postBid({ email: 'jamie@x.com', amountCents: 5_500 });

      expect(reply.status).toBe(201);
      expect(reply.json).toEqual({
        bidId: 'bid-2',
        auctionId: 'auc-1',
        amountCents: 5_500,
        status: 'LEADING',
        placedAt: placedAt.toISOString(),
        closeAt: closeAt.toISOString(),
        minimumNextBidCents: 6_000,
      });
    });

    it('passes the normalized email, cents and auction id to the service', async () => {
      await postBid({ email: 'Jamie@X.com', amountCents: 5_500 });

      expect(placeBid).toHaveBeenCalledTimes(1);
      expect(placeBid).toHaveBeenCalledWith({ auctionId: 'auc-1', email: 'jamie@x.com', amountCents: 5_500 });
    });

    it('exposes no bidder identity', async () => {
      const reply = await postBid({ email: 'jamie@x.com', amountCents: 5_500 });

      expect(reply.json).not.toHaveProperty('bidderId');
      expect(reply.json).not.toHaveProperty('email');
      expect(reply.json).not.toHaveProperty('previousLeader');
    });
  });

  describe('when the usecase throws a domain error', () => {
    it.each([
      [new InvalidValueError('bid_below_minimum'), 'bid_below_minimum', 400],
      [new InvalidValueError('bid_above_maximum'), 'bid_above_maximum', 400],
      [new ForbiddenError('self_bid_not_allowed'), 'self_bid_not_allowed', 403],
      [new NotFoundError('auction_not_found'), 'auction_not_found', 404],
      [new ConflictError('auction_not_open'), 'auction_not_open', 409],
      [new ConflictError('already_leading'), 'already_leading', 409],
    ])('maps %j to its status', async (error, code, status) => {
      placeBid.mockRejectedValue(error);

      const reply = await postBid({ email: 'jamie@x.com', amountCents: 5_500 });

      expect(reply.status).toBe(status);
      expect(reply.json.message).toBe(code);
    });
  });

  describe('when the body is invalid', () => {
    it.each([
      ['email is missing', { amountCents: 5_500 }],
      ['email is malformed', { email: 'not-an-email', amountCents: 5_500 }],
      ['amount is zero', { email: 'jamie@x.com', amountCents: 0 }],
      ['amount is fractional', { email: 'jamie@x.com', amountCents: 12.5 }],
      ['amount is a string', { email: 'jamie@x.com', amountCents: '5000' }],
      ['amount is missing', { email: 'jamie@x.com' }],
      ['an extra field is sent', { email: 'jamie@x.com', amountCents: 5_500, bidderId: 'bidder-9' }],
    ])('rejects when %s', async (_label, body) => {
      const reply = await postBid(body);

      expect(reply.status).toBe(400);
      expect(reply.json.message).toBe('validation_failed');
      expect(placeBid).not.toHaveBeenCalled();
    });
  });

  describe('when the auction id is blank', () => {
    it('rejects with auction_id_invalid', async () => {
      const reply = await postBid({ email: 'jamie@x.com', amountCents: 5_500 }, '%20');

      expect(reply.status).toBe(400);
      expect(reply.json.message).toBe('auction_id_invalid');
      expect(placeBid).not.toHaveBeenCalled();
    });
  });
});
