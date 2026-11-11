import { Logger } from '@nestjs/common';
import type { MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { AthleteRow } from '../athletes/athlete.db';
import { AthleteDb } from '../athletes/athlete.db';
import { ConflictError, ForbiddenError, NotFoundError } from '../common/domain-error';
import type { AthleteId } from '../common/ids';
import { StripeUnavailableError } from '../common/stripe-errors';
import type { StripeConnectAccountId } from '../common/stripe-ids';
import { StripeGateway, type ConnectAccountSnapshot } from '../stripe/stripe-gateway';
import { ConnectService } from './connect.service';

const athleteId = 'athlete-1' as AthleteId;
const createdAccount = 'acct_created' as StripeConnectAccountId;
const storedAccount = 'acct_stored' as StripeConnectAccountId;
const expiresAt = new Date('2026-11-10T12:05:00Z');
const link = { url: 'https://connect.stripe.test/setup/abc', expiresAt };

function athleteRow(overrides: Partial<AthleteRow> = {}): AthleteRow {
  return {
    id: athleteId,
    email: 'jamie@example.com',
    isAdult: true,
    isBanned: false,
    stripeConnectAccountId: null,
    stripeConnectDetailsSubmitted: false,
    stripeConnectPayoutsEnabled: false,
    ...overrides,
  } as AthleteRow;
}

function snapshot(id: StripeConnectAccountId): ConnectAccountSnapshot {
  return {
    id,
    detailsSubmitted: false,
    payoutsEnabled: false,
    transfersActive: false,
    requirementsDue: [],
    disabledReason: null,
  };
}

describe('ConnectService', () => {
  let athletes: DeepMockProxy<AthleteDb>;
  let gateway: DeepMockProxy<StripeGateway>;
  let service: ConnectService;
  let error: MockInstance;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    athletes = mockDeep<AthleteDb>();
    gateway = mockDeep<StripeGateway>();
    gateway.createOnboardingLink.mockResolvedValue(link);
    service = new ConnectService(athletes, gateway);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createOnboardingLink', () => {
    describe('when the athlete is missing', () => {
      it('throws athlete_not_found', async () => {
        athletes.findById.mockResolvedValue(null);

        await expect(service.createOnboardingLink(athleteId)).rejects.toThrow(new NotFoundError('athlete_not_found'));
        expect(gateway.createExpressAccount).not.toHaveBeenCalled();
      });
    });

    describe('when the athlete is banned', () => {
      it('throws athlete_banned', async () => {
        athletes.findById.mockResolvedValue(athleteRow({ isBanned: true }));

        await expect(service.createOnboardingLink(athleteId)).rejects.toThrow(new ForbiddenError('athlete_banned'));
        expect(gateway.createExpressAccount).not.toHaveBeenCalled();
      });
    });

    describe('when the athlete is not an attested adult', () => {
      it('throws athlete_not_adult', async () => {
        athletes.findById.mockResolvedValue(athleteRow({ isAdult: false }));

        await expect(service.createOnboardingLink(athleteId)).rejects.toThrow(new ForbiddenError('athlete_not_adult'));
        expect(gateway.createExpressAccount).not.toHaveBeenCalled();
      });
    });

    describe('when the athlete has no account yet', () => {
      beforeEach(() => {
        athletes.findById.mockResolvedValue(athleteRow());
        gateway.createExpressAccount.mockResolvedValue(snapshot(createdAccount));
      });

      describe('and the compare-and-set wins', () => {
        beforeEach(() => {
          athletes.setStripeConnectAccountIdIfUnset.mockResolvedValue(
            athleteRow({ stripeConnectAccountId: createdAccount }),
          );
        });

        it('creates the account with the athlete id and normalized email', async () => {
          await service.createOnboardingLink(athleteId);

          expect(gateway.createExpressAccount).toHaveBeenCalledWith({ athleteId, email: 'jamie@example.com' });
        });

        it('stores the created account id', async () => {
          await service.createOnboardingLink(athleteId);

          expect(athletes.setStripeConnectAccountIdIfUnset).toHaveBeenCalledWith(athleteId, createdAccount);
        });

        it('returns a link for the created account', async () => {
          await expect(service.createOnboardingLink(athleteId)).resolves.toEqual(link);
          expect(gateway.createOnboardingLink).toHaveBeenCalledWith(createdAccount);
        });
      });

      describe('and the compare-and-set loses the race', () => {
        beforeEach(() => {
          athletes.setStripeConnectAccountIdIfUnset.mockResolvedValue(null);
        });

        describe('and another request stored an id', () => {
          beforeEach(() => {
            athletes.findById
              .mockResolvedValueOnce(athleteRow())
              .mockResolvedValueOnce(athleteRow({ stripeConnectAccountId: storedAccount }));
          });

          it('returns a link for the stored account', async () => {
            await expect(service.createOnboardingLink(athleteId)).resolves.toEqual(link);
            expect(gateway.createOnboardingLink).toHaveBeenCalledWith(storedAccount);
          });

          it('logs the orphaned account at error level with a marker', async () => {
            await service.createOnboardingLink(athleteId);

            expect(error).toHaveBeenCalledWith(expect.stringContaining('[connect_account_orphaned]'));
          });
        });

        describe('and the athlete vanished', () => {
          beforeEach(() => {
            athletes.findById.mockResolvedValueOnce(athleteRow()).mockResolvedValueOnce(null);
          });

          it('throws athlete_not_found', async () => {
            await expect(service.createOnboardingLink(athleteId)).rejects.toThrow(
              new NotFoundError('athlete_not_found'),
            );
          });
        });

        describe('and no id is stored (taken by another athlete)', () => {
          beforeEach(() => {
            athletes.findById.mockResolvedValue(athleteRow());
          });

          it('throws connect_account_conflict without creating a link', async () => {
            await expect(service.createOnboardingLink(athleteId)).rejects.toThrow(
              new ConflictError('connect_account_conflict'),
            );
            expect(gateway.createOnboardingLink).not.toHaveBeenCalled();
          });
        });
      });
    });

    describe('when the athlete already has an account', () => {
      it.each([
        ['incomplete', {}],
        ['ready', { stripeConnectDetailsSubmitted: true, stripeConnectPayoutsEnabled: true }],
      ])('only creates a link when %s', async (_label, overrides) => {
        athletes.findById.mockResolvedValue(athleteRow({ stripeConnectAccountId: storedAccount, ...overrides }));

        await expect(service.createOnboardingLink(athleteId)).resolves.toEqual(link);
        expect(gateway.createExpressAccount).not.toHaveBeenCalled();
        expect(athletes.setStripeConnectAccountIdIfUnset).not.toHaveBeenCalled();
        expect(gateway.createOnboardingLink).toHaveBeenCalledWith(storedAccount);
      });
    });

    describe('when Stripe is unavailable creating the account', () => {
      it('propagates the error and stores nothing', async () => {
        athletes.findById.mockResolvedValue(athleteRow());
        gateway.createExpressAccount.mockRejectedValue(new StripeUnavailableError());

        await expect(service.createOnboardingLink(athleteId)).rejects.toThrow(StripeUnavailableError);
        expect(athletes.setStripeConnectAccountIdIfUnset).not.toHaveBeenCalled();
      });
    });
  });

  describe('getStatus', () => {
    describe('when the athlete is missing', () => {
      it('throws athlete_not_found', async () => {
        athletes.findById.mockResolvedValue(null);

        await expect(service.getStatus(athleteId)).rejects.toThrow(new NotFoundError('athlete_not_found'));
      });
    });

    describe.each([
      ['NOT_STARTED', {}],
      ['INCOMPLETE', { stripeConnectAccountId: storedAccount }],
      ['RESTRICTED', { stripeConnectAccountId: storedAccount, stripeConnectDetailsSubmitted: true }],
      [
        'READY',
        {
          stripeConnectAccountId: storedAccount,
          stripeConnectDetailsSubmitted: true,
          stripeConnectPayoutsEnabled: true,
        },
      ],
    ])('when the athlete is %s', (expected, overrides) => {
      beforeEach(() => {
        athletes.findById.mockResolvedValue(athleteRow(overrides));
      });

      it('returns the derived status without calling Stripe', async () => {
        await expect(service.getStatus(athleteId)).resolves.toBe(expected);
        expect(gateway.retrieveAccount).not.toHaveBeenCalled();
        expect(gateway.createOnboardingLink).not.toHaveBeenCalled();
      });
    });
  });
});
