import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import type { BodyZone } from '@hyrox-sponsor/shared/body-zone';
import ZoneFloorPricePanel from './ZoneFloorPricePanel.svelte';
import { FloorPriceApiError } from './floor-price-api.ts';
import type { FloorPriceView } from './floor-price-api.ts';

const PRICES: FloorPriceView[] = [
  { zone: 'LEFT_PEC', floorPriceCents: 2500, isDefault: false },
  { zone: 'RIGHT_PEC', floorPriceCents: 1000, isDefault: true },
];

describe('ZoneFloorPricePanel', () => {
  let onsave: Mock<(zone: BodyZone, floorPriceCents: number) => Promise<void>>;

  function renderPanel(selected: BodyZone | null): ReturnType<typeof render> {
    return render(ZoneFloorPricePanel, { selected, prices: PRICES, onsave });
  }

  function priceInput(name = 'Left pec floor price'): HTMLInputElement {
    return screen.getByRole('textbox', { name }) as HTMLInputElement;
  }

  function saveButton(): HTMLElement {
    return screen.getByRole('button', { name: 'Save' });
  }

  beforeEach(() => {
    onsave = vi
      .fn<(zone: BodyZone, floorPriceCents: number) => Promise<void>>()
      .mockResolvedValue(undefined);
  });

  describe('when no zone is selected', () => {
    it('prompts to choose a zone', () => {
      renderPanel(null);

      expect(screen.getByText('Choose a zone on the map.')).toBeInTheDocument();
    });

    it('shows no input', () => {
      renderPanel(null);

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });

  describe('when a zone is selected', () => {
    it('shows a labelled numeric input with the saved whole dollars', () => {
      renderPanel('LEFT_PEC');

      expect(priceInput()).toHaveValue('25');
      expect(priceInput()).toHaveAttribute('inputmode', 'numeric');
    });

    it('disables Save while unchanged', () => {
      renderPanel('LEFT_PEC');

      expect(saveButton()).toBeDisabled();
    });
  });

  describe('when the draft is below the minimum', () => {
    beforeEach(async () => {
      renderPanel('LEFT_PEC');
      await userEvent.clear(priceInput());
      await userEvent.type(priceInput(), '9');
    });

    it('shows the error on the invalid input', () => {
      expect(screen.getByText('Minimum floor price is $10.')).toBeInTheDocument();
      expect(priceInput()).toHaveAttribute('aria-invalid', 'true');
    });

    it('disables Save', () => {
      expect(saveButton()).toBeDisabled();
    });
  });

  describe('when the draft has a decimal point', () => {
    beforeEach(async () => {
      renderPanel('LEFT_PEC');
      await userEvent.clear(priceInput());
      await userEvent.type(priceInput(), '10.5');
    });

    it('shows an error and disables Save', () => {
      expect(screen.getByText('Enter a whole dollar amount, like 25.')).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });
  });

  describe('when the draft is valid and changed', () => {
    beforeEach(async () => {
      renderPanel('LEFT_PEC');
      await userEvent.clear(priceInput());
      await userEvent.type(priceInput(), '40');
    });

    it('enables Save', () => {
      expect(saveButton()).toBeEnabled();
    });

    it('saves the zone and cents once', async () => {
      await userEvent.click(saveButton());

      expect(onsave).toHaveBeenCalledTimes(1);
      expect(onsave).toHaveBeenCalledWith('LEFT_PEC', 4000);
    });

    it('announces the result', async () => {
      await userEvent.click(saveButton());

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent('Saved Left pec floor price.');
      });
    });
  });

  describe('when the draft is emptied', () => {
    it('disables Save without an error', async () => {
      renderPanel('LEFT_PEC');
      await userEvent.clear(priceInput());

      expect(saveButton()).toBeDisabled();
      expect(priceInput()).not.toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('when saving is in flight', () => {
    beforeEach(async () => {
      onsave.mockReturnValue(new Promise(() => {}));
      renderPanel('LEFT_PEC');
      await userEvent.clear(priceInput());
      await userEvent.type(priceInput(), '40');
      await userEvent.click(saveButton());
    });

    it('disables the button', () => {
      expect(saveButton()).toBeDisabled();
    });

    it('announces saving politely', () => {
      expect(screen.getByRole('status')).toHaveTextContent('Saving');
    });
  });

  describe('when save fails with a server code', () => {
    beforeEach(async () => {
      onsave.mockRejectedValue(new FloorPriceApiError(400, 'floor_price_below_minimum'));
      renderPanel('LEFT_PEC');
      await userEvent.clear(priceInput());
      await userEvent.type(priceInput(), '40');
      await userEvent.click(saveButton());
    });

    it('shows the mapped copy', async () => {
      expect(await screen.findByText('Minimum floor price is $10.')).toBeInTheDocument();
    });

    it('keeps the draft', async () => {
      await screen.findByText('Minimum floor price is $10.');

      expect(priceInput()).toHaveValue('40');
    });
  });

  describe('when the zone has only the default price', () => {
    it('allows saving an explicit minimum', async () => {
      renderPanel('RIGHT_PEC');

      expect(saveButton()).toBeEnabled();

      await userEvent.click(saveButton());

      expect(onsave).toHaveBeenCalledWith('RIGHT_PEC', 1000);
    });
  });

  describe('when the selection changes during a save', () => {
    it('announces the zone that was saved', async () => {
      let finishSave: () => void = () => {};

      onsave.mockReturnValue(
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
      );

      const { rerender } = renderPanel('LEFT_PEC');

      await userEvent.clear(priceInput());
      await userEvent.type(priceInput(), '40');
      await userEvent.click(saveButton());
      await rerender({ selected: 'RIGHT_PEC', prices: PRICES, onsave });
      finishSave();

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent('Saved Left pec floor price.');
      });
    });
  });

  describe('when switching zones after a failed save', () => {
    it('clears the stale error', async () => {
      onsave.mockRejectedValue(new FloorPriceApiError(400, 'floor_price_below_minimum'));

      const { rerender } = renderPanel('LEFT_PEC');

      await userEvent.clear(priceInput());
      await userEvent.type(priceInput(), '40');
      await userEvent.click(saveButton());
      await screen.findByText('Minimum floor price is $10.');
      await rerender({ selected: 'RIGHT_PEC', prices: PRICES, onsave });

      expect(screen.queryByText('Minimum floor price is $10.')).not.toBeInTheDocument();
    });
  });

  describe('when switching zones', () => {
    it('keeps the first zone unsaved draft', async () => {
      const { rerender } = renderPanel('LEFT_PEC');

      await userEvent.clear(priceInput());
      await userEvent.type(priceInput(), '40');
      await rerender({ selected: 'RIGHT_PEC', prices: PRICES, onsave });

      expect(priceInput('Right pec floor price')).toHaveValue('10');

      await rerender({ selected: 'LEFT_PEC', prices: PRICES, onsave });

      expect(priceInput()).toHaveValue('40');
    });
  });
});
