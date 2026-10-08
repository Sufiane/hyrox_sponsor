import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { BODY_MAP_VIEWS, regionsForZone } from '@hyrox-sponsor/shared/body-map-geometry';
import type { BodyZone } from '@hyrox-sponsor/shared/body-zone';
import BodyMap from './BodyMap.svelte';

function regionById(id: string): HTMLElement {
  const region = document.querySelector<HTMLElement>(`[data-region-id="${id}"]`);

  if (region == null) {
    throw new Error(`missing region ${id}`);
  }

  return region;
}

const REGION_IDS = BODY_MAP_VIEWS.flatMap((view) => view.regions.map((region) => region.id));

describe('BodyMap', () => {
  let onselect: (zone: BodyZone) => void;

  beforeEach(() => {
    onselect = vi.fn();
  });

  describe('when rendered', () => {
    it('shows thirteen button regions', () => {
      render(BodyMap, { selected: null, onselect });

      expect(screen.getAllByRole('button')).toHaveLength(13);
    });

    it('labels both views as groups', () => {
      render(BodyMap, { selected: null, onselect });

      expect(screen.getByRole('group', { name: 'Front view' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Back view' })).toBeInTheDocument();
    });

    it('names regions with zone and view', () => {
      render(BodyMap, { selected: null, onselect });

      expect(screen.getByRole('button', { name: 'Left pec, front view' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Glutes, back view' })).toBeInTheDocument();
    });

    it('orders the front view regions before the back view regions', () => {
      render(BodyMap, { selected: null, onselect });

      const ids = screen
        .getAllByRole('button')
        .map((region) => region.getAttribute('data-region-id'));

      expect(ids).toEqual(REGION_IDS);
    });

    it('captions arm and thigh regions with both views', () => {
      render(BodyMap, { selected: null, onselect });

      expect(within(regionById('front-left-arm')).getByText('Left arm (front + back)')).toBeTruthy();
      expect(within(regionById('back-left-thigh')).getByText('Left thigh (front + back)')).toBeTruthy();
    });
  });

  describe('when clicking a region', () => {
    it.each(REGION_IDS)('emits the zone for %s', async (id) => {
      const user = userEvent.setup();
      render(BodyMap, { selected: null, onselect });

      await user.click(regionById(id));

      const zone = BODY_MAP_VIEWS.flatMap((view) => view.regions).find(
        (region) => region.id === id,
      )!.zone;

      expect(onselect).toHaveBeenCalledWith(zone);
    });
  });

  describe('when activating with the keyboard', () => {
    it('emits on Enter', async () => {
      const user = userEvent.setup();
      render(BodyMap, { selected: null, onselect });

      regionById('front-left-pec').focus();
      await user.keyboard('{Enter}');

      expect(onselect).toHaveBeenCalledWith('LEFT_PEC');
    });

    it('emits on Space', async () => {
      const user = userEvent.setup();
      render(BodyMap, { selected: null, onselect });

      regionById('back-ass').focus();
      await user.keyboard(' ');

      expect(onselect).toHaveBeenCalledWith('ASS');
    });

    it('does not emit on Space keydown alone', async () => {
      const user = userEvent.setup();
      render(BodyMap, { selected: null, onselect });

      regionById('back-ass').focus();
      await user.keyboard('[Space>]');

      expect(onselect).not.toHaveBeenCalled();
    });

    it('emits once per Enter press', async () => {
      const user = userEvent.setup();
      render(BodyMap, { selected: null, onselect });

      regionById('back-ass').focus();
      await user.keyboard('{Enter}');

      expect(onselect).toHaveBeenCalledTimes(1);
    });
  });

  describe('when a zone is selected', () => {
    beforeEach(() => {
      render(BodyMap, { selected: 'LEFT_ARM', onselect });
    });

    it('presses both regions of that zone', () => {
      expect(regionById('front-left-arm')).toHaveAttribute('aria-pressed', 'true');
      expect(regionById('back-left-arm')).toHaveAttribute('aria-pressed', 'true');
    });

    it('leaves other regions unpressed', () => {
      expect(regionById('front-right-arm')).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows the zone label in the chip', () => {
      expect(screen.getByTestId('selected-chip')).toHaveTextContent('Left arm');
    });

    it('announces the selection politely', () => {
      const status = screen.getByRole('status');

      expect(status).toHaveTextContent('Left arm selected');
      expect(status).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('when nothing is selected', () => {
    it('leaves the chip and live region empty', () => {
      render(BodyMap, { selected: null, onselect });

      expect(screen.getByTestId('selected-chip').textContent).toBe('');
      expect(screen.getByRole('status').textContent?.trim()).toBe('');
    });
  });

  describe('when clicking an arm region on one view', () => {
    it('presses the region on the other view too', async () => {
      const user = userEvent.setup();
      render(BodyMap, { selected: null, onselect });

      await user.click(regionById('back-right-arm'));

      expect(regionById('front-right-arm')).toHaveAttribute('aria-pressed', 'true');
      expect(regionById('back-right-arm')).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('when re-clicking the selected zone', () => {
    it('keeps it selected', async () => {
      const user = userEvent.setup();
      render(BodyMap, { selected: 'LEFT_PEC', onselect });

      await user.click(regionById('front-left-pec'));

      expect(regionById('front-left-pec')).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('when hovering an arm region', () => {
    it('highlights both regions of the zone', async () => {
      const user = userEvent.setup();
      render(BodyMap, { selected: null, onselect });

      await user.hover(regionById('front-left-arm'));

      expect(regionById('front-left-arm')).toHaveAttribute('data-highlighted', 'true');
      expect(regionById('back-left-arm')).toHaveAttribute('data-highlighted', 'true');
      expect(regionById('front-right-arm')).toHaveAttribute('data-highlighted', 'false');
    });
  });

  describe('when focusing a thigh region', () => {
    it('highlights both regions of the zone', () => {
      render(BodyMap, { selected: null, onselect });

      regionById('back-right-thigh').focus();

      return vi.waitFor(() => {
        expect(regionById('front-right-thigh')).toHaveAttribute('data-highlighted', 'true');
      });
    });
  });

  describe('when a zone is disabled', () => {
    beforeEach(() => {
      render(BodyMap, {
        selected: null,
        onselect,
        zoneStates: { LEFT_PEC: { disabled: true } },
      });
    });

    it('does not emit on click', async () => {
      const user = userEvent.setup();

      await user.click(regionById('front-left-pec'));

      expect(onselect).not.toHaveBeenCalled();
    });

    it('marks the region aria-disabled', () => {
      expect(regionById('front-left-pec')).toHaveAttribute('aria-disabled', 'true');
    });

    it('still emits for other zones', async () => {
      const user = userEvent.setup();

      await user.click(regionById('front-right-pec'));

      expect(onselect).toHaveBeenCalledWith('RIGHT_PEC');
    });
  });

  describe('when the whole map is disabled', () => {
    it('does not emit on click or key', async () => {
      const user = userEvent.setup();
      render(BodyMap, { selected: null, onselect, disabled: true });

      await user.click(regionById('back-ass'));
      regionById('back-ass').focus();
      await user.keyboard('{Enter}');

      expect(onselect).not.toHaveBeenCalled();
    });
  });

  describe('when a zone has a badge', () => {
    beforeEach(() => {
      render(BodyMap, { selected: null, onselect, zoneStates: { ASS: { badge: '$25' } } });
    });

    it('includes the badge in the accessible name', () => {
      expect(screen.getByRole('button', { name: 'Glutes, back view, $25' })).toBeInTheDocument();
    });

    it('renders the badge text near the region', () => {
      expect(within(regionById('back-ass')).getByText('$25')).toBeInTheDocument();
    });

    it('places the badge at the region anchor', () => {
      const badge = within(regionById('back-ass')).getByText('$25');
      const { anchor } = regionsForZone('ASS')[0];

      expect(badge).toHaveAttribute('x', String(anchor.x));
      expect(badge).toHaveAttribute('y', String(anchor.y));
    });
  });

  describe('when checking anatomical left and right', () => {
    it('places the LEFT pec on the viewer right of the front view', () => {
      render(BodyMap, { selected: null, onselect });

      const left = regionsForZone('LEFT_PEC')[0].anchor;
      const right = regionsForZone('RIGHT_PEC')[0].anchor;

      expect(left.x).toBeGreaterThan(right.x);
    });
  });

  describe('when checking touch targets', () => {
    it('gives every region with a wider hit area a transparent hit path', () => {
      render(BodyMap, { selected: null, onselect });

      for (const view of BODY_MAP_VIEWS) {
        for (const region of view.regions) {
          const hit = regionById(region.id).querySelector('.touch-target');

          if (region.hitPathData == null) {
            expect(hit).toBeNull();
          } else {
            expect(hit).toHaveAttribute('d', region.hitPathData);
          }
        }
      }
    });
  });
});
