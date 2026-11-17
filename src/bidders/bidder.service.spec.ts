import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { vi } from 'vitest';
import { InvalidValueError } from '../common/domain-error';
import type { BidderId } from '../common/ids';
import type { StripeCustomerId, StripePaymentMethodId, StripeSetupIntentId } from '../common/stripe-ids';
import { BidderService } from './bidder.service';
import { BidderDb } from './bidder.db';
import { CreatePaymentSetupUsecase } from './usecases/create-payment-setup/create-payment-setup.usecase';
import { SyncPaymentMethodUsecase } from './usecases/sync-payment-method/sync-payment-method.usecase';

describe('BidderService', () => {
  const bidderId = 'bidder-1' as BidderId;
  const customerId = 'cus_123' as StripeCustomerId;
  let db: DeepMockProxy<BidderDb>;
  let usecase: DeepMockProxy<CreatePaymentSetupUsecase>;
  let syncUsecase: DeepMockProxy<SyncPaymentMethodUsecase>;
  let service: BidderService;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    db = mockDeep<BidderDb>();
    usecase = mockDeep<CreatePaymentSetupUsecase>();
    syncUsecase = mockDeep<SyncPaymentMethodUsecase>();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        BidderService,
        { provide: BidderDb, useValue: db },
        { provide: CreatePaymentSetupUsecase, useValue: usecase },
        { provide: SyncPaymentMethodUsecase, useValue: syncUsecase },
      ],
    }).compile();
    service = moduleRef.get(BidderService);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('syncPaymentMethod', () => {
    describe('when called', () => {
      it('delegates to the usecase', async () => {
        const command = {
          setupIntentId: 'seti_1' as StripeSetupIntentId,
          customerId,
          paymentMethodId: 'pm_1' as StripePaymentMethodId,
        };
        syncUsecase.execute.mockResolvedValue('saved');

        expect(await service.syncPaymentMethod(command)).toBe('saved');
        expect(syncUsecase.execute).toHaveBeenCalledWith(command);
      });
    });
  });

  describe('createPaymentSetup', () => {
    describe('when called', () => {
      it('returns the usecase result for the same input', async () => {
        const input = { email: 'jamie@x.com', bidderToken: undefined };
        const result = { clientSecret: 'secret' };
        usecase.execute.mockResolvedValue(result as never);

        const returned = await service.createPaymentSetup(input);

        expect(returned).toBe(result);
        expect(usecase.execute).toHaveBeenCalledWith(input);
      });
    });
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
});
