import { trustScore } from './trust-score';

describe('trustScore', () => {
  describe('when the value is an integer within 0..100', () => {
    it('returns the value', () => {
      expect(trustScore(50)).toBe(50);
    });

    it('accepts the lower bound', () => {
      expect(trustScore(0)).toBe(0);
    });

    it('accepts the upper bound', () => {
      expect(trustScore(100)).toBe(100);
    });
  });

  describe('when the value is below 0', () => {
    it('throws', () => {
      expect(() => trustScore(-1)).toThrow('trust_score_invalid');
    });
  });

  describe('when the value is above 100', () => {
    it('throws', () => {
      expect(() => trustScore(101)).toThrow('trust_score_invalid');
    });
  });

  describe('when the value is not an integer', () => {
    it('throws', () => {
      expect(() => trustScore(50.5)).toThrow('trust_score_invalid');
    });
  });

  describe('when the value is NaN', () => {
    it('throws', () => {
      expect(() => trustScore(Number.NaN)).toThrow('trust_score_invalid');
    });
  });
});
