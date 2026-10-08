import { BodyZone } from '@prisma/client';
import { ZONE_ORDER } from './zone-order';

describe('ZONE_ORDER', () => {
  describe('when compared with the Prisma BodyZone enum', () => {
    it('lists the same zones in enum order', () => {
      expect([...ZONE_ORDER]).toEqual(Object.keys(BodyZone));
    });
  });
});
