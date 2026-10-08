import { BodyZone } from '@prisma/client';
import { BODY_ZONES } from '@hyrox-sponsor/shared/body-zone';

describe('BODY_ZONES contract', () => {
  describe('when compared with the Prisma BodyZone enum', () => {
    it('has the same values', () => {
      expect([...BODY_ZONES].sort()).toEqual(Object.keys(BodyZone).sort());
    });
  });
});
