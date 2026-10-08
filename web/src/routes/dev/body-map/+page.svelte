<script lang="ts">
  import type { BodyZone } from '@hyrox-sponsor/shared/body-zone';
  import BodyMap from '../../../lib/body-map/BodyMap.svelte';
  import { createFloorPriceApi } from '../../../lib/floor-price/floor-price-api.ts';
  import type { FloorPriceView } from '../../../lib/floor-price/floor-price-api.ts';
  import { zoneStatesFromPrices } from '../../../lib/floor-price/floor-price-state.ts';
  import ZoneFloorPricePanel from '../../../lib/floor-price/ZoneFloorPricePanel.svelte';

  let selected = $state<BodyZone | null>(null);
  let prices = $state<FloorPriceView[]>([]);
  let accessToken = $state('');
  let loadFailed = $state(false);

  const api = createFloorPriceApi({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
    getAccessToken: () => (accessToken.trim() === '' ? null : accessToken.trim()),
  });

  const zoneStates = $derived(zoneStatesFromPrices(prices));

  async function loadPrices(): Promise<void> {
    loadFailed = false;

    try {
      prices = await api.getFloorPrices();
    } catch {
      prices = [];
      loadFailed = true;
    }
  }

  async function savePrice(zone: BodyZone, floorPriceCents: number): Promise<void> {
    const saved = await api.saveFloorPrice(zone, floorPriceCents);

    prices = prices.some((price) => price.zone === zone)
      ? prices.map((price) => (price.zone === zone ? saved : price))
      : [...prices, saved];
  }
</script>

<main class="mx-auto flex max-w-4xl flex-col gap-8 p-6 md:flex-row md:items-start">
  <section class="flex-1" aria-label="Body map">
    <BodyMap bind:selected {zoneStates} />
  </section>

  <section class="flex w-full flex-col gap-4 md:w-72">
    <h1 class="text-lg font-semibold text-slate-900">Zone floor price</h1>

    <div class="flex flex-col gap-1 rounded border border-dashed border-slate-500 p-3">
      <label for="dev-access-token" class="text-sm font-medium text-slate-900">
        Access token (dev only)
      </label>
      <input
        id="dev-access-token"
        class="rounded border border-slate-500 px-2 py-1 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        type="password"
        autocomplete="off"
        bind:value={accessToken}
      />
      <p class="text-xs text-slate-700">Stopgap until HYR-30 adds web login. Not stored.</p>
      <button
        type="button"
        class="mt-1 self-start rounded border border-slate-500 px-3 py-1 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        onclick={loadPrices}
      >
        Load prices
      </button>
      {#if loadFailed}
        <p class="text-sm text-red-700">Could not load prices. Check the token and API URL.</p>
      {/if}
    </div>

    <ZoneFloorPricePanel {selected} {prices} onsave={savePrice} />
  </section>
</main>
