<script lang="ts">
  import { BODY_ZONE_LABELS } from '@hyrox-sponsor/shared/body-zone-labels';
  import type { BodyZone } from '@hyrox-sponsor/shared/body-zone';
  import {
    FLOOR_PRICE_STEP_CENTS,
    PLATFORM_MINIMUM_FLOOR_PRICE_CENTS,
    formatCents,
    parseWholeDollarsToCents,
  } from '@hyrox-sponsor/shared/floor-price';
  import { FloorPriceApiError } from './floor-price-api.ts';
  import type { FloorPriceView } from './floor-price-api.ts';
  import { draftError, errorCopy } from './floor-price-state.ts';

  interface Props {
    selected: BodyZone | null;
    prices: FloorPriceView[];
    onsave: (zone: BodyZone, floorPriceCents: number) => Promise<void>;
    disabled?: boolean;
  }

  let { selected, prices, onsave, disabled = false }: Props = $props();

  let drafts = $state<Partial<Record<BodyZone, string>>>({});
  let saving = $state(false);
  let saveErrorCode = $state<string | null>(null);
  let statusText = $state('');

  const label = $derived(selected == null ? '' : `${BODY_ZONE_LABELS[selected]} floor price`);
  const savedEntry = $derived(prices.find((price) => price.zone === selected));
  const savedDollars = $derived(
    savedEntry == null ? '' : String(savedEntry.floorPriceCents / FLOOR_PRICE_STEP_CENTS),
  );
  const draft = $derived(selected == null ? '' : (drafts[selected] ?? savedDollars));
  const localErrorCode = $derived(draftError(draft));
  const errorCode = $derived(saveErrorCode ?? localErrorCode);
  const parsedCents = $derived(parseWholeDollarsToCents(draft));
  const canSave = $derived(
    !disabled &&
      !saving &&
      localErrorCode == null &&
      parsedCents != null &&
      (savedEntry?.isDefault === true || draft.trim() !== savedDollars),
  );
  const hint = `Whole dollars, minimum ${formatCents(PLATFORM_MINIMUM_FLOOR_PRICE_CENTS)}.`;

  $effect(() => {
    void selected;
    saveErrorCode = null;
    statusText = '';
  });

  function handleInput(event: Event): void {
    if (selected == null) {
      return;
    }

    drafts[selected] = (event.currentTarget as HTMLInputElement).value;
    saveErrorCode = null;
    statusText = '';
  }

  async function save(): Promise<void> {
    if (selected == null || parsedCents == null || !canSave) {
      return;
    }

    const zone = selected;
    const savedLabel = label;

    saving = true;
    saveErrorCode = null;
    statusText = 'Saving…';

    try {
      await onsave(zone, parsedCents);
      delete drafts[zone];
      statusText = `Saved ${savedLabel}.`;
    } catch (error) {
      saveErrorCode = error instanceof FloorPriceApiError ? error.code : 'request_failed';
      statusText = '';
    } finally {
      saving = false;
    }
  }
</script>

<div class="flex flex-col gap-2">
  {#if selected == null}
    <p class="text-sm text-slate-700">Choose a zone on the map.</p>
  {:else}
    <label for="floor-price-input" class="text-sm font-medium text-slate-900">{label}</label>
    <div class="flex items-center gap-2">
      <div class="relative flex-1">
        <span class="pointer-events-none absolute inset-y-0 left-2 flex items-center text-slate-700">$</span>
        <input
          id="floor-price-input"
          class="w-full rounded border border-slate-500 py-2 pr-2 pl-6 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 aria-[invalid=true]:border-red-700 disabled:opacity-60"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          value={draft}
          {disabled}
          aria-invalid={errorCode == null ? undefined : 'true'}
          aria-describedby={errorCode == null ? 'floor-price-hint' : 'floor-price-hint floor-price-error'}
          oninput={handleInput}
        />
      </div>
      <button
        type="button"
        class="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
        disabled={!canSave}
        onclick={save}
      >
        Save
      </button>
    </div>
    <p id="floor-price-hint" class="text-xs text-slate-700">{hint}</p>
    {#if errorCode != null}
      <p id="floor-price-error" class="text-sm text-red-700">{errorCopy(errorCode)}</p>
    {/if}
  {/if}
  <p role="status" aria-live="polite" class="min-h-5 text-sm text-slate-700">{statusText}</p>
</div>
