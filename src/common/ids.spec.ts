import { InvalidValueError } from './domain-error';
import { athleteId, auctionId, bidderId, raceEntryId, raceId, raceResultId, staffId } from './ids';

describe('athleteId', () => {
  describe('when the value is a non-blank string', () => {
    it('returns the trimmed value', () => {
      expect(athleteId('  ath_1 ')).toBe('ath_1');
    });
  });

  describe('when the value is blank', () => {
    it('throws an InvalidValueError', () => {
      expect(() => athleteId('   ')).toThrow(InvalidValueError);
      expect(() => athleteId('   ')).toThrow('athlete_id_invalid');
    });
  });

  describe('when the value is longer than 64 characters', () => {
    it('throws', () => {
      expect(() => athleteId('a'.repeat(65))).toThrow('athlete_id_invalid');
    });
  });
});

describe('raceEntryId', () => {
  describe('when the value is a non-blank string', () => {
    it('returns the trimmed value', () => {
      expect(raceEntryId('  id_1 ')).toBe('id_1');
    });
  });

  describe('when the value is blank', () => {
    it('throws an InvalidValueError', () => {
      expect(() => raceEntryId('   ')).toThrow(InvalidValueError);
      expect(() => raceEntryId('   ')).toThrow('race_entry_id_invalid');
    });
  });

  describe('when the value is longer than 64 characters', () => {
    it('throws', () => {
      expect(() => raceEntryId('a'.repeat(65))).toThrow('race_entry_id_invalid');
    });
  });
});

describe('staffId', () => {
  describe('when the value is a non-blank string', () => {
    it('returns the trimmed value', () => {
      expect(staffId('  id_1 ')).toBe('id_1');
    });
  });

  describe('when the value is blank', () => {
    it('throws an InvalidValueError', () => {
      expect(() => staffId('   ')).toThrow(InvalidValueError);
      expect(() => staffId('   ')).toThrow('staff_id_invalid');
    });
  });

  describe('when the value is longer than 64 characters', () => {
    it('throws', () => {
      expect(() => staffId('a'.repeat(65))).toThrow('staff_id_invalid');
    });
  });
});

describe.each([
  ['raceId', raceId, 'race_id_invalid'],
  ['raceResultId', raceResultId, 'race_result_id_invalid'],
])('%s', (_name, build, code) => {
  describe('when the value is a non-blank string', () => {
    it('returns the trimmed value', () => {
      expect(build('  id_1 ')).toBe('id_1');
    });
  });

  describe('when the value is blank', () => {
    it('throws an InvalidValueError', () => {
      expect(() => build('   ')).toThrow(InvalidValueError);
      expect(() => build('   ')).toThrow(code);
    });
  });

  describe('when the value is longer than 64 characters', () => {
    it('throws', () => {
      expect(() => build('a'.repeat(65))).toThrow(code);
    });
  });
});

describe('auctionId', () => {
  describe('when the value is a non-blank string', () => {
    it('returns the trimmed value', () => {
      expect(auctionId(' auction_1 ')).toBe('auction_1');
    });
  });

  describe('when the value is blank', () => {
    it('throws auction_id_invalid', () => {
      expect(() => auctionId('  ')).toThrow(new InvalidValueError('auction_id_invalid'));
    });
  });

  describe('when the value is longer than 64 characters', () => {
    it('throws auction_id_invalid', () => {
      expect(() => auctionId('x'.repeat(65))).toThrow(new InvalidValueError('auction_id_invalid'));
    });
  });
});

describe('bidderId', () => {
  describe('when the value is a non-blank string', () => {
    it('returns the trimmed value', () => {
      expect(bidderId(' bidder_1 ')).toBe('bidder_1');
    });
  });

  describe('when the value is blank', () => {
    it('throws bidder_id_invalid', () => {
      expect(() => bidderId('')).toThrow(new InvalidValueError('bidder_id_invalid'));
    });
  });
});
