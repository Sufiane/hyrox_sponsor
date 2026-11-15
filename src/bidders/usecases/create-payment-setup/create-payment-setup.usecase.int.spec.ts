import { JwtService } from '@nestjs/jwt';
import type { BidderId } from '../../../common/ids';
import { stripeCustomerId, stripeSetupIntentId } from '../../../common/stripe-ids';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { StripeGateway } from '../../../stripe/stripe-gateway';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  requireReachableInCi,
  type ThrowawayDatabase,
} from '../../../testing/throwaway-database';
import { BidderTokenService } from '../../bidder-token.service';
import { CreatePaymentSetupUsecase } from './create-payment-setup.usecase';
import { CreatePaymentSetupUsecaseDb } from './create-payment-setup.usecase.db';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const reachable = requireReachableInCi(await isPostgresReachable(adminUrl), process.env);
const SECRET = 'integration-secret-integration-secret';

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe.skipIf(!reachable)('CreatePaymentSetupUsecase (postgres)', () => {
  let database: ThrowawayDatabase;
  let prisma: PrismaService;
  let createCustomerCalls: number;
  let gateway: StripeGateway;
  let onSetupIntent: () => Promise<void>;
  let tokens: BidderTokenService;
  let usecase: CreatePaymentSetupUsecase;

  function buildUsecase(ttlSeconds: number): { usecase: CreatePaymentSetupUsecase; tokens: BidderTokenService } {
    const tokenService = new BidderTokenService(new JwtService({ secret: SECRET }), { ttlSeconds });

    return {
      usecase: new CreatePaymentSetupUsecase(new CreatePaymentSetupUsecaseDb(prisma), gateway, tokenService),
      tokens: tokenService,
    };
  }

  async function giveCard(email: string): Promise<BidderId> {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "bidders"
      SET "default_payment_method_id" = 'pm_1', "card_brand" = 'visa', "card_last4" = '4242',
          "token_version" = "token_version" + 1
      WHERE "email" = ${email}
      RETURNING "id"`;

    return rows[0].id as BidderId;
  }

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
    gateway = {
      createCustomer: async (input: { bidderId: string }) => {
        createCustomerCalls += 1;

        return stripeCustomerId(`cus_${input.bidderId}`);
      },
      createSetupIntent: async () => {
        await onSetupIntent();

        return { id: stripeSetupIntentId('seti_1'), clientSecret: 'seti_1_secret_x' };
      },
    } as unknown as StripeGateway;
  });

  beforeEach(() => {
    createCustomerCalls = 0;
    onSetupIntent = async (): Promise<void> => undefined;
    ({ usecase, tokens } = buildUsecase(900));
  });

  afterAll(async () => {
    await database?.drop();
  });

  describe('when the email is new', () => {
    it('stores the bidder with a customer id and issues a verifiable token', async () => {
      const result = await usecase.execute({ email: 'New@Example.com', bidderToken: undefined });

      const bidder = await prisma.bidder.findUniqueOrThrow({ where: { email: 'new@example.com' } });
      expect(bidder.stripeCustomerId).toBe(`cus_${bidder.id}`);
      expect(await tokens.verify(result.bidderToken)).toEqual({ bidderId: bidder.id, tokenVersion: 0 });
      expect(result.clientSecret).toBe('seti_1_secret_x');
    });
  });

  describe('when the same email calls again with no card', () => {
    it('creates the Stripe customer once', async () => {
      await usecase.execute({ email: 'again@example.com', bidderToken: undefined });
      await usecase.execute({ email: 'again@example.com', bidderToken: undefined });

      expect(createCustomerCalls).toBe(1);
    });
  });

  describe('when two first calls run concurrently', () => {
    it('keeps one bidder and one customer id and both succeed', async () => {
      const results = await Promise.all([
        usecase.execute({ email: 'race@example.com', bidderToken: undefined }),
        usecase.execute({ email: 'race@example.com', bidderToken: undefined }),
      ]);

      const rows = await prisma.bidder.findMany({ where: { email: 'race@example.com' } });
      expect(results).toHaveLength(2);
      expect(rows).toHaveLength(1);
      expect(rows[0].stripeCustomerId).toBe(`cus_${rows[0].id}`);
    });
  });

  describe('when the bidder has a card', () => {
    const email = 'carded@example.com';
    let bidderIdentifier: BidderId;
    let preCardToken: string;

    beforeAll(async () => {
      ({ usecase, tokens } = buildUsecase(900));
      const first = await usecase.execute({ email, bidderToken: undefined });
      preCardToken = first.bidderToken;
      bidderIdentifier = await giveCard(email);
    });

    describe('and no token is sent', () => {
      it('rejects with bidder_token_required', async () => {
        const before = createCustomerCalls;

        await expect(usecase.execute({ email, bidderToken: undefined })).rejects.toMatchObject({
          message: 'bidder_token_required',
        });

        expect(createCustomerCalls).toBe(before);
      });
    });

    describe('and a token issued before the card was saved is sent', () => {
      it('rejects with bidder_token_required', async () => {
        await expect(usecase.execute({ email, bidderToken: preCardToken })).rejects.toMatchObject({
          message: 'bidder_token_required',
        });
      });
    });

    describe('and a token at the current version is sent', () => {
      it('succeeds', async () => {
        const fresh = await tokens.issue(bidderIdentifier, 1);

        const result = await usecase.execute({ email, bidderToken: fresh.token });

        expect(result.clientSecret).toBe('seti_1_secret_x');
        await expect(tokens.verify(result.bidderToken)).resolves.toEqual({
          bidderId: bidderIdentifier,
          tokenVersion: 1,
        });
      });
    });

    describe('and a token without a version is sent', () => {
      it('rejects with bidder_token_required', async () => {
        const unversioned = await new JwtService({ secret: SECRET }).signAsync(
          { sub: bidderIdentifier },
          { algorithm: 'HS256', expiresIn: 900, audience: 'hyrox-bidder', issuer: 'hyrox-api' },
        );

        await expect(usecase.execute({ email, bidderToken: unversioned })).rejects.toMatchObject({
          message: 'bidder_token_required',
        });
      });
    });

    describe("and another bidder's token is sent", () => {
      it('rejects with bidder_token_required', async () => {
        const other = await usecase.execute({ email: 'other@example.com', bidderToken: undefined });

        await expect(usecase.execute({ email, bidderToken: other.bidderToken })).rejects.toMatchObject({
          message: 'bidder_token_required',
        });
      });
    });

    describe('and the token is expired', () => {
      it('rejects with bidder_token_required', async () => {
        const short = buildUsecase(1);
        const issued = await short.tokens.issue(bidderIdentifier, 1);
        await sleep(1_200);

        await expect(short.usecase.execute({ email, bidderToken: issued.token })).rejects.toMatchObject({
          message: 'bidder_token_required',
        });
      });
    });
  });

  describe('when a card is saved while the request is in flight', () => {
    const email = 'inflight@example.com';

    beforeEach(() => {
      onSetupIntent = async (): Promise<void> => {
        await giveCard(email);
      };
    });

    describe('and no token was sent', () => {
      it('rejects instead of issuing a token', async () => {
        await expect(usecase.execute({ email, bidderToken: undefined })).rejects.toMatchObject({
          message: 'bidder_token_required',
        });
      });
    });
  });

  describe('when the card columns are half written', () => {
    beforeAll(async () => {
      await prisma.bidder.create({ data: { email: 'half@example.com' } });
    });

    it('rejects a lone card brand', async () => {
      await expect(
        prisma.bidder.update({ where: { email: 'half@example.com' }, data: { cardBrand: 'visa' } }),
      ).rejects.toThrow();
    });

    it('rejects a non-numeric last4', async () => {
      await expect(
        prisma.bidder.update({
          where: { email: 'half@example.com' },
          data: { defaultPaymentMethodId: 'pm_1', cardBrand: 'visa', cardLast4: '12a4' },
        }),
      ).rejects.toThrow();
    });

    it('rejects a payment method and brand with no last4', async () => {
      await expect(
        prisma.bidder.update({
          where: { email: 'half@example.com' },
          data: { defaultPaymentMethodId: 'pm_1', cardBrand: 'visa' },
        }),
      ).rejects.toThrow();
    });

    it('accepts a full card and an empty row', async () => {
      const full = await giveCard('half@example.com');

      const cleared = await prisma.bidder.update({
        where: { id: full },
        data: { defaultPaymentMethodId: null, cardBrand: null, cardLast4: null },
      });

      expect(cleared.cardLast4).toBeNull();
    });
  });
});
