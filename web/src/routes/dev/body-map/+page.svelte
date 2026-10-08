<script lang="ts">
  import type { BodyZone } from '@hyrox-sponsor/shared/body-zone';
  import BodyMap from '../../../lib/body-map/BodyMap.svelte';
  import type { ZoneStates } from '../../../lib/body-map/body-map-state.ts';

  let selected = $state<BodyZone | null>(null);

  const zoneStates: ZoneStates = {
    LEFT_PEC: { badge: '$25' },
    RIGHT_THIGH: { badge: '$40' },
    LOWER_BACK: { disabled: true },
  };
</script>

<main class="mx-auto flex max-w-4xl flex-col gap-8 p-6 md:flex-row md:items-start">
  <section class="flex-1" aria-label="Body map">
    <BodyMap bind:selected {zoneStates} />
  </section>

  <section class="w-full md:w-72">
    <h1 class="text-lg font-semibold text-slate-900">Zone floor price</h1>
    {#if selected == null}
      <p class="mt-2 text-sm text-slate-700">Choose a zone on the map.</p>
    {:else}
      <label class="mt-2 flex flex-col gap-1 text-sm text-slate-900">
        Floor price for {selected}
        <input
          class="rounded border border-slate-500 px-2 py-1"
          type="number"
          min="10"
          inputmode="decimal"
        />
      </label>
    {/if}
  </section>
</main>
