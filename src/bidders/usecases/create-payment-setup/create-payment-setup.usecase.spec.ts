import { ConflictException, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { BidderToken } from '../../../common/bidder-token';
import type { BidderId } from '../../../common/ids';
import type { StripeCustomerId, StripeSetupIntentId } from '../../../common/stripe-ids';
import type { StripeGateway } from '../../../stripe/stripe-gateway';
import type { BidderTokenService } from '../../bidder-token.service';
import { CreatePaymentSetupUsecase } from './create-payment-setup.usecase';
import type { CreatePaymentSetupUsecaseDb } from './create-payment-setup.usecase.db';

describe('CreatePaymentSetupUsecase', () => {
  const id = 'bidder-1' as BidderId;
  const customerId = 'cus_1' as StripeCustomerId;
  const issuedToken = 'signed.token' as BidderToken;
  const expiresAt = new Date('2026-11-16T12:00:00Z');
  let db: DeepMockProxy<CreatePaymentSetupUsecaseDb>;
  let stripe: DeepMockProxy<StripeGateway>;
  let tokens: DeepMockProxy<BidderTokenService>;
  let warn: ReturnType<typeof vi.spyOn>;
  let usecase: CreatePaymentSetupUsecase;

  function row(overrides: Record<string, unknown> = {}): never {
    return {
      id,
      email: 'jamie@x.com',
      stripeCustomerId: null,
      defaultPaymentMethodId: null,
      tokenVersion: 0,
      ...overrides,
    } as never;
  }

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db = mockDeep<CreatePaymentSetupUsecaseDb>();
    stripe = mockDeep<StripeGateway>();
    tokens = mockDeep<BidderTokenService>();
    stripe.createCustomer.mockResolvedValue(customerId);
    stripe.createSetupIntent.mockResolvedValue({ id: 'seti_1' as StripeSetupIntentId, clientSecret: 'seti_secret' });
    tokens.issue.mockResolvedValue({ token: issuedToken, expiresAt });
    db.upsertByEmail.mockResolvedValue(row());
    db.findById.mockResolvedValue(row());
    db.setStripeCustomerIdIfUnset.mockResolvedValue(row({ stripeCustomerId: customerId }));
    usecase = new CreatePaymentSetupUsecase(db, stripe, tokens);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the email is invalid', () => {
    it('rejects with email_invalid and never touches the db', async () => {
      await expect(usecase.execute({ email: 'nope', bidderToken: undefined })).rejects.toMatchObject({
        message: 'email_invalid',
      });

      expect(db.upsertByEmail).not.toHaveBeenCalled();
    });
  });

  describe('when the email has mixed case', () => {
    it('upserts the normalised email', async () => {
      await usecase.execute({ email: '  Jamie@X.COM ', bidderToken: undefined });

      expect(db.upsertByEmail).toHaveBeenCalledWith('jamie@x.com');
    });
  });

  describe('when the bidder has no card and no Stripe customer', () => {
    it('creates the customer, stores it, opens a setup intent and issues a token', async () => {
      const result = await usecase.execute({ email: 'jamie@x.com', bidderToken: undefined });

      expect(stripe.createCustomer).toHaveBeenCalledWith({ bidderId: id, email: 'jamie@x.com' });
      expect(db.setStripeCustomerIdIfUnset).toHaveBeenCalledWith(id, customerId);
      expect(stripe.createSetupIntent).toHaveBeenCalledWith(customerId);
      expect(tokens.issue).toHaveBeenCalledWith(id, 0);
      expect(result).toEqual({
        clientSecret: 'seti_secret',
        bidderToken: issuedToken,
        bidderTokenExpiresAt: expiresAt,
      });
      expect(tokens.verify).not.toHaveBeenCalled();
    });
  });

  describe('when the bidder has no card but already has a Stripe customer', () => {
    beforeEach(() => {
      db.upsertByEmail.mockResolvedValue(row({ stripeCustomerId: 'cus_existing' }));
    });

    it('reuses the customer without creating or storing one', async () => {
      await usecase.execute({ email: 'jamie@x.com', bidderToken: undefined });

      expect(stripe.createCustomer).not.toHaveBeenCalled();
      expect(db.setStripeCustomerIdIfUnset).not.toHaveBeenCalled();
      expect(stripe.createSetupIntent).toHaveBeenCalledWith('cus_existing');
    });
  });

  describe('when the bidder has a card', () => {
    beforeEach(() => {
      db.upsertByEmail.mockResolvedValue(row({ stripeCustomerId: customerId, defaultPaymentMethodId: 'pm_1' }));
    });

    describe('and no token is sent', () => {
      beforeEach(() => {
        tokens.verify.mockRejectedValue(new UnauthorizedException('bidder_token_required'));
      });

      it('rejects with bidder_token_required and calls nothing else', async () => {
        await expect(usecase.execute({ email: 'jamie@x.com', bidderToken: undefined })).rejects.toMatchObject({
          message: 'bidder_token_required',
        });

        expect(stripe.createSetupIntent).not.toHaveBeenCalled();
        expect(tokens.issue).not.toHaveBeenCalled();
      });
    });

    describe('and the token is valid for this bidder', () => {
      beforeEach(() => {
        db.upsertByEmail.mockResolvedValue(row({ defaultPaymentMethodId: 'pm_1', tokenVersion: 1 }));
        db.findById.mockResolvedValue(row({ defaultPaymentMethodId: 'pm_1', tokenVersion: 1 }));
        tokens.verify.mockResolvedValue({ bidderId: id, tokenVersion: 1 });
      });

      it('succeeds with a fresh token at the current version', async () => {
        const result = await usecase.execute({ email: 'jamie@x.com', bidderToken: 'raw' });

        expect(tokens.verify).toHaveBeenCalledTimes(1);
        expect(tokens.verify).toHaveBeenCalledWith('raw');
        expect(tokens.issue).toHaveBeenCalledWith(id, 1);
        expect(result.bidderToken).toBe(issuedToken);
      });
    });

    describe('and the token belongs to another bidder', () => {
      beforeEach(() => {
        tokens.verify.mockResolvedValue({ bidderId: 'bidder-2' as BidderId, tokenVersion: 0 });
      });

      it('rejects with bidder_token_required and logs both ids', async () => {
        await expect(usecase.execute({ email: 'jamie@x.com', bidderToken: 'raw' })).rejects.toMatchObject({
          message: 'bidder_token_required',
        });

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('bidder-2'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('bidder-1'));
        expect(stripe.createSetupIntent).not.toHaveBeenCalled();
      });
    });

    describe('and the token version is stale', () => {
      beforeEach(() => {
        db.upsertByEmail.mockResolvedValue(row({ defaultPaymentMethodId: 'pm_1', tokenVersion: 1 }));
        tokens.verify.mockResolvedValue({ bidderId: id, tokenVersion: 0 });
      });

      it('rejects with bidder_token_required and logs the version mismatch', async () => {
        await expect(usecase.execute({ email: 'jamie@x.com', bidderToken: 'old' })).rejects.toMatchObject({
          message: 'bidder_token_required',
        });

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale'));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('old'));
        expect(stripe.createSetupIntent).not.toHaveBeenCalled();
      });
    });

    describe('and the token is expired', () => {
      beforeEach(() => {
        tokens.verify.mockRejectedValue(new UnauthorizedException('bidder_token_required'));
      });

      it('propagates the rejection before calling Stripe', async () => {
        await expect(usecase.execute({ email: 'jamie@x.com', bidderToken: 'old' })).rejects.toBeInstanceOf(
          UnauthorizedException,
        );

        expect(stripe.createSetupIntent).not.toHaveBeenCalled();
      });
    });
  });

  describe('when a card lands after the first read', () => {
    beforeEach(() => {
      db.findById.mockResolvedValue(row({ defaultPaymentMethodId: 'pm_1', tokenVersion: 1 }));
    });

    describe('and no token was sent', () => {
      beforeEach(() => {
        tokens.verify.mockRejectedValue(new UnauthorizedException('bidder_token_required'));
      });

      it('rejects instead of issuing a token', async () => {
        await expect(usecase.execute({ email: 'jamie@x.com', bidderToken: undefined })).rejects.toMatchObject({
          message: 'bidder_token_required',
        });

        expect(tokens.issue).not.toHaveBeenCalled();
      });
    });

    describe('and the token matches the new version', () => {
      beforeEach(() => {
        tokens.verify.mockResolvedValue({ bidderId: id, tokenVersion: 1 });
      });

      it('issues a token at the new version', async () => {
        await usecase.execute({ email: 'jamie@x.com', bidderToken: 'raw' });

        expect(tokens.issue).toHaveBeenCalledWith(id, 1);
      });
    });
  });

  describe('when the bidder vanishes before the re-read', () => {
    beforeEach(() => {
      db.findById.mockResolvedValue(null);
    });

    it('rejects with bidder_not_found', async () => {
      await expect(usecase.execute({ email: 'jamie@x.com', bidderToken: undefined })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('when the customer write returns null', () => {
    beforeEach(() => {
      db.setStripeCustomerIdIfUnset.mockResolvedValue(null);
    });

    it('rejects with bidder_not_found and opens no setup intent', async () => {
      await expect(usecase.execute({ email: 'jamie@x.com', bidderToken: undefined })).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('bidder-1'));
      expect(stripe.createSetupIntent).not.toHaveBeenCalled();
    });
  });

  describe('when the stored customer is a different Stripe id', () => {
    beforeEach(() => {
      db.setStripeCustomerIdIfUnset.mockResolvedValue(row({ stripeCustomerId: 'cus_other' }));
    });

    it('rejects with a conflict and issues nothing', async () => {
      await expect(usecase.execute({ email: 'jamie@x.com', bidderToken: undefined })).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('cus_other'));
      expect(stripe.createSetupIntent).not.toHaveBeenCalled();
      expect(tokens.issue).not.toHaveBeenCalled();
    });
  });

  describe('when the stored customer equals the created id', () => {
    it('proceeds to the setup intent', async () => {
      await usecase.execute({ email: 'jamie@x.com', bidderToken: undefined });

      expect(stripe.createSetupIntent).toHaveBeenCalledWith(customerId);
    });
  });

  describe('when Stripe fails creating the setup intent', () => {
    beforeEach(() => {
      stripe.createSetupIntent.mockRejectedValue(new Error('stripe_down'));
    });

    it('propagates the error and issues no token', async () => {
      await expect(usecase.execute({ email: 'jamie@x.com', bidderToken: undefined })).rejects.toThrow('stripe_down');

      expect(tokens.issue).not.toHaveBeenCalled();
    });
  });
});
