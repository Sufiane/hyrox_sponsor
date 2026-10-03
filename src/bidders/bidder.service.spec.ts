import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { vi } from 'vitest';
import { InvalidValueError } from '../common/domain-error';
import type { BidderId } from '../common/ids';
import type { StripeCustomerId } from '../common/stripe-ids';
import { BidderService } from './bidder.service';
import { BidderDb } from './bidder.db';

describe('BidderService', () => {
  const bidderId = 'bidder-1' as BidderId;
  const customerId = 'cus_123' as StripeCustomerId;
  let db: DeepMockProxy<BidderDb>;
  let service: BidderService;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    db = mockDeep<BidderDb>();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [BidderService, { provide: BidderDb, useValue: db }],
    }).compile();
    service = moduleRef.get(BidderService);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('getOrCreateByEmail', () => {
    describe('when the email is already normalised', () => {
      const bidder = { id: 'bidder-1', email: 'brand@example.com' };

      beforeEach(() => {
        db.upsertByEmail.mockResolvedValue(bidder as never);
      });

      it('upserts it unchanged and returns the bidder', async () => {
        const result = await service.getOrCreateByEmail('brand@example.com');

        expect(db.upsertByEmail).toHaveBeenCalledWith('brand@example.com');
        expect(result).toEqual(bidder);
      });
    });

    describe('when the email has mixed case and surrounding whitespace', () => {
      beforeEach(() => {
        db.upsertByEmail.mockResolvedValue({} as never);
      });

      it('upserts the trimmed lowercase email', async () => {
        await service.getOrCreateByEmail('  Jamie@Example.COM ');

        expect(db.upsertByEmail).toHaveBeenCalledWith('jamie@example.com');
      });
    });

    describe('when the email is invalid', () => {
      it('rejects with email_invalid and never touches the db', async () => {
        await expect(service.getOrCreateByEmail('not-an-email')).rejects.toThrow(InvalidValueError);
        await expect(service.getOrCreateByEmail('not-an-email')).rejects.toThrow('email_invalid');

        expect(db.upsertByEmail).not.toHaveBeenCalled();
      });
    });
  });

  describe('getById', () => {
    describe('when the bidder exists', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId } as never);
      });

      it('returns it', async () => {
        await expect(service.getById(bidderId)).resolves.toEqual({ id: bidderId });
      });
    });

    describe('when the bidder does not exist', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue(null);
      });

      it('throws bidder_not_found and logs the id', async () => {
        await expect(service.getById(bidderId)).rejects.toThrow(new NotFoundException('bidder_not_found'));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining(bidderId));
      });
    });
  });

  describe('attachStripeCustomer', () => {
    describe('when the bidder does not exist', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue(null);
      });

      it('throws bidder_not_found', async () => {
        await expect(service.attachStripeCustomer(bidderId, customerId)).rejects.toThrow(
          new NotFoundException('bidder_not_found'),
        );

        expect(db.setStripeCustomerIdIfUnset).not.toHaveBeenCalled();
      });
    });

    describe('when the bidder has no Stripe customer yet', () => {
      const attached = { id: bidderId, stripeCustomerId: customerId };

      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId, stripeCustomerId: null } as never);
        db.setStripeCustomerIdIfUnset.mockResolvedValue(attached as never);
      });

      it('stores it and returns the updated bidder', async () => {
        const result = await service.attachStripeCustomer(bidderId, customerId);

        expect(db.setStripeCustomerIdIfUnset).toHaveBeenCalledWith(bidderId, customerId);
        expect(result).toEqual(attached);
      });
    });

    describe('when the bidder already has the same Stripe customer', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId, stripeCustomerId: customerId } as never);
      });

      it('returns it unchanged without writing', async () => {
        const result = await service.attachStripeCustomer(bidderId, customerId);

        expect(result).toEqual({ id: bidderId, stripeCustomerId: customerId });
        expect(db.setStripeCustomerIdIfUnset).not.toHaveBeenCalled();
      });
    });

    describe('when the bidder already has a different Stripe customer', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId, stripeCustomerId: 'cus_other' } as never);
      });

      it('throws bidder_stripe_customer_conflict and logs the ids', async () => {
        await expect(service.attachStripeCustomer(bidderId, customerId)).rejects.toThrow(
          new ConflictException('bidder_stripe_customer_conflict'),
        );

        expect(warn).toHaveBeenCalledWith(expect.stringContaining(bidderId));
        expect(db.setStripeCustomerIdIfUnset).not.toHaveBeenCalled();
      });
    });

    describe('when another request attaches a different customer first', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId, stripeCustomerId: null } as never);
        db.setStripeCustomerIdIfUnset.mockResolvedValue({ id: bidderId, stripeCustomerId: 'cus_other' } as never);
      });

      it('throws bidder_stripe_customer_conflict', async () => {
        await expect(service.attachStripeCustomer(bidderId, customerId)).rejects.toThrow(
          new ConflictException('bidder_stripe_customer_conflict'),
        );
      });
    });

    describe('when the write returns a bidder with no Stripe customer', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId, stripeCustomerId: null } as never);
        db.setStripeCustomerIdIfUnset.mockResolvedValue({ id: bidderId, stripeCustomerId: null } as never);
      });

      it('throws bidder_not_found', async () => {
        await expect(service.attachStripeCustomer(bidderId, customerId)).rejects.toThrow(
          new NotFoundException('bidder_not_found'),
        );
      });
    });

    describe('when the bidder is deleted between the read and the write', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId, stripeCustomerId: null } as never);
        db.setStripeCustomerIdIfUnset.mockResolvedValue(null);
      });

      it('throws bidder_not_found', async () => {
        await expect(service.attachStripeCustomer(bidderId, customerId)).rejects.toThrow(
          new NotFoundException('bidder_not_found'),
        );
      });
    });
  });
});
