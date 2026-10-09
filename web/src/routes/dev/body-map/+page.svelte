<script lang="ts">
  import { goto } from '$app/navigation';
  import type { BodyZone } from '@hyrox-sponsor/shared/body-zone';
  import AuthGate from '../../../lib/auth/AuthGate.svelte';
  import { createAuthedFetch } from '../../../lib/auth/authed-fetch.ts';
  import LogoutButton from '../../../lib/auth/LogoutButton.svelte';
  import { session } from '../../../lib/auth/session.svelte.ts';
  import BodyMap from '../../../lib/body-map/BodyMap.svelte';
  import { createFloorPriceApi } from '../../../lib/floor-price/floor-price-api.ts';
  import type { FloorPriceView } from '../../../lib/floor-price/floor-price-api.ts';
  import { zoneStatesFromPrices } from '../../../lib/floor-price/floor-price-state.ts';
  import ZoneFloorPricePanel from '../../../lib/floor-price/ZoneFloorPricePanel.svelte';

  let selected = $state<BodyZone | null>(null);
  let prices = $state<FloorPriceView[]>([]);
  let loadFailed = $state(false);

  const api = createFloorPriceApi({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
    fetchImpl: createAuthedFetch({ session }),
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

  $effect(() => {
    if (session.status === 'authenticated') {
      void loadPrices();
    }
  });
</script>

<AuthGate {session} {goto}>
  <main class="mx-auto flex max-w-4xl flex-col gap-8 p-6 md:flex-row md:items-start">
    <section class="flex-1" aria-label="Body map">
      <BodyMap bind:selected {zoneStates} />
    </section>

    <section class="flex w-full flex-col gap-4 md:w-72">
      <h1 class="text-lg font-semibold text-slate-900">Zone floor price</h1>

      <div>
        <LogoutButton {session} />
      </div>

      {#if loadFailed}
        <p role="alert" class="text-sm text-red-700">Could not load prices. Try again.</p>
      {/if}

      <ZoneFloorPricePanel {selected} {prices} onsave={savePrice} />
    </section>
  </main>
</AuthGate>
