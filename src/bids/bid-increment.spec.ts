import { cents } from '../common/money';
import { minimumIncrementCents, minimumNextBidCents } from './bid-increment';

describe('minimumIncrementCents', () => {
  describe('when the leader is under $100', () => {
    it.each([
      [0, 500],
      [1_000, 500],
      [9_999, 500],
    ])('leader %i cents -> increment %i', (leader, expected) => {
      expect(minimumIncrementCents(cents(leader))).toBe(expected);
    });
  });

  describe('when the leader is exactly $100', () => {
    it('is the same as the flat increment', () => {
      expect(minimumIncrementCents(cents(10_000))).toBe(500);
    });
  });

  describe('when the leader is above $100', () => {
    it.each([
      [10_010, 501],
      [10_100, 505],
      [100_000, 5_000],
      [99_999_999, 5_000_000],
    ])('leader %i cents -> increment %i (5%% rounded up)', (leader, expected) => {
      expect(minimumIncrementCents(cents(leader))).toBe(expected);
    });
  });
});

describe('minimumNextBidCents', () => {
  const floor = cents(2_500);

  describe('when there is no leader', () => {
    it('is the floor', () => {
      expect(minimumNextBidCents(null, floor)).toBe(2_500);
    });
  });

  describe('when the leader is under $100', () => {
    it('adds the flat increment', () => {
      expect(minimumNextBidCents(cents(3_000), floor)).toBe(3_500);
    });
  });

  describe('when the leader is exactly $100', () => {
    it('adds the flat increment', () => {
      expect(minimumNextBidCents(cents(10_000), floor)).toBe(10_500);
    });
  });

  describe('when the leader is above $100', () => {
    it.each([
      [10_100, 10_605],
      [10_010, 10_511],
      [99_999_999, 104_999_999],
    ])('leader %i cents -> next bid %i (5%% rounded up)', (leader, expected) => {
      expect(minimumNextBidCents(cents(leader), floor)).toBe(expected);
    });
  });
});
