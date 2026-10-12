import { TOS_VERSION } from '@hyrox-sponsor/shared/tos-version';
import { CURRENT_TOS_VERSION } from './tos-version';

describe('tos version contract', () => {
  describe('when compared with the shared web constant', () => {
    it('is the same version', () => {
      expect(CURRENT_TOS_VERSION).toBe(TOS_VERSION);
    });
  });
});
