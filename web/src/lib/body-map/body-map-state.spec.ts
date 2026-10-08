import {
  isZoneInteractive,
  nextSelection,
  regionAccessibleName,
  zoneCaption,
} from './body-map-state.ts';

describe('isZoneInteractive', () => {
  describe('when the whole map is disabled', () => {
    it('is false', () => {
      expect(isZoneInteractive('LEFT_PEC', { disabled: true })).toBe(false);
    });
  });

  describe('when the zone is disabled in zoneStates', () => {
    it('is false for that zone', () => {
      const zoneStates = { LEFT_PEC: { disabled: true } };

      expect(isZoneInteractive('LEFT_PEC', { zoneStates })).toBe(false);
    });

    it('is true for other zones', () => {
      const zoneStates = { LEFT_PEC: { disabled: true } };

      expect(isZoneInteractive('RIGHT_PEC', { zoneStates })).toBe(true);
    });
  });

  describe('when nothing is disabled', () => {
    it('is true', () => {
      expect(isZoneInteractive('ASS', {})).toBe(true);
    });
  });
});

describe('nextSelection', () => {
  describe('when a different zone is chosen', () => {
    it('returns the chosen zone', () => {
      expect(nextSelection('LEFT_PEC', 'RIGHT_PEC', {})).toBe('RIGHT_PEC');
    });
  });

  describe('when the selected zone is chosen again', () => {
    it('stays selected', () => {
      expect(nextSelection('LEFT_ARM', 'LEFT_ARM', {})).toBe('LEFT_ARM');
    });
  });

  describe('when the chosen zone is not interactive', () => {
    it('keeps the current selection', () => {
      expect(nextSelection('LEFT_PEC', 'ASS', { disabled: true })).toBe('LEFT_PEC');
    });
  });

  describe('when nothing is selected yet', () => {
    it('returns the chosen zone', () => {
      expect(nextSelection(null, 'ASS', {})).toBe('ASS');
    });
  });
});

describe('regionAccessibleName', () => {
  describe('when the zone has no badge', () => {
    it('names the zone and the view', () => {
      expect(regionAccessibleName('LEFT_PEC', 'Front view', undefined)).toBe(
        'Left pec, front view',
      );
    });
  });

  describe('when the zone has a badge', () => {
    it('appends the badge text', () => {
      expect(regionAccessibleName('ASS', 'Back view', { badge: '$25' })).toBe(
        'Glutes, back view, $25',
      );
    });
  });
});

describe('zoneCaption', () => {
  describe('when the zone appears on both views', () => {
    it('mentions both views', () => {
      expect(zoneCaption('LEFT_ARM')).toBe('Left arm (front + back)');
    });
  });

  describe('when the zone appears on one view', () => {
    it('is null', () => {
      expect(zoneCaption('LEFT_PEC')).toBeNull();
    });
  });
});
