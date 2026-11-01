import { InvalidValueError } from './domain-error';
import { stripeConnectAccountId, stripeCustomerId, stripePaymentIntentId } from './stripe-ids';

const cases = [
  {
    name: 'stripeConnectAccountId',
    build: stripeConnectAccountId,
    prefix: 'acct_',
    code: 'stripe_connect_account_id_invalid',
  },
  {
    name: 'stripePaymentIntentId',
    build: stripePaymentIntentId,
    prefix: 'pi_',
    code: 'stripe_payment_intent_id_invalid',
  },
  {
    name: 'stripeCustomerId',
    build: stripeCustomerId,
    prefix: 'cus_',
    code: 'stripe_customer_id_invalid',
  },
];

describe.each(cases)('$name', ({ build, prefix, code }) => {
  describe('when the value has the right prefix', () => {
    it('returns the value', () => {
      expect(build(`${prefix}1AbC`)).toBe(`${prefix}1AbC`);
    });
  });

  describe('when the value has surrounding whitespace', () => {
    it('returns it trimmed', () => {
      expect(build(`  ${prefix}1AbC \n`)).toBe(`${prefix}1AbC`);
    });
  });

  describe('when the prefix is wrong', () => {
    it('throws', () => {
      expect(() => build('xyz_1AbC')).toThrow(InvalidValueError);
      expect(() => build('xyz_1AbC')).toThrow(code);
    });
  });

  describe('when there is nothing after the prefix', () => {
    it('throws', () => {
      expect(() => build(prefix)).toThrow(code);
    });
  });

  describe('when the value is empty', () => {
    it('throws', () => {
      expect(() => build('  ')).toThrow(code);
    });
  });

  describe('when the value is longer than 255 characters', () => {
    it('throws', () => {
      expect(() => build(`${prefix}${'a'.repeat(256 - prefix.length)}`)).toThrow(code);
    });
  });

  describe('when the value is exactly 255 characters', () => {
    it('returns the value', () => {
      const value = `${prefix}${'a'.repeat(255 - prefix.length)}`;

      expect(build(value)).toBe(value);
    });
  });
});
