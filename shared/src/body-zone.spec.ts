import { BODY_ZONES } from './body-zone.ts';
import { BODY_ZONE_LABELS } from './body-zone-labels.ts';

describe('BODY_ZONES', () => {
  it('has exactly nine zones', () => {
    expect(BODY_ZONES).toHaveLength(9);
  });

  it('has unique values', () => {
    expect(new Set(BODY_ZONES).size).toBe(9);
  });

  it('matches the persisted zone names', () => {
    expect([...BODY_ZONES]).toEqual([
      'LEFT_PEC',
      'RIGHT_PEC',
      'UPPER_BACK',
      'LOWER_BACK',
      'LEFT_ARM',
      'RIGHT_ARM',
      'LEFT_THIGH',
      'RIGHT_THIGH',
      'ASS',
    ]);
  });
});

describe('BODY_ZONE_LABELS', () => {
  it('has a non-empty label for every zone', () => {
    for (const zone of BODY_ZONES) {
      expect(BODY_ZONE_LABELS[zone].length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate labels', () => {
    expect(new Set(Object.values(BODY_ZONE_LABELS)).size).toBe(9);
  });

  describe('when the zone is ASS', () => {
    it('is labelled Glutes', () => {
      expect(BODY_ZONE_LABELS.ASS).toBe('Glutes');
    });
  });
});
