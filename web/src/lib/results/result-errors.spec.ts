import { resultErrorMessage } from './result-errors.ts';

describe('resultErrorMessage', () => {
  it.each([
    'finish_time_out_of_range',
    'proof_photo_missing',
    'proof_photo_too_large',
    'proof_photo_type_unsupported',
    'proof_url_invalid',
    'proof_url_host_not_allowed',
    'race_not_finished',
    'athlete_banned',
    'result_state_changed',
    'validation_failed',
    'not_authenticated',
    'race_entry_not_found',
  ])('has a specific message for %s', (code) => {
    expect(resultErrorMessage(code)).not.toBe(resultErrorMessage('unknown_code'));
  });

  describe('when throttled', () => {
    it('asks to wait', () => {
      expect(resultErrorMessage('anything', 429)).toMatch(/Wait a minute/);
    });
  });

  describe('when the upload is rejected as too large', () => {
    it('explains the photo limit', () => {
      expect(resultErrorMessage('File too large', 413)).toMatch(/10 MB/);
    });
  });

  describe('when the code is unknown', () => {
    it('returns the generic message', () => {
      expect(resultErrorMessage('boom')).toBe('Something went wrong. Try again.');
    });
  });
});
