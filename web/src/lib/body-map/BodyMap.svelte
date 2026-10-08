<script lang="ts">
  import { BODY_MAP_VIEWS } from '@hyrox-sponsor/shared/body-map-geometry';
  import { BODY_ZONE_LABELS } from '@hyrox-sponsor/shared/body-zone-labels';
  import type { BodyZone } from '@hyrox-sponsor/shared/body-zone';
  import {
    isZoneInteractive,
    nextSelection,
    regionAccessibleName,
    zoneCaption,
  } from './body-map-state.ts';
  import type { ZoneStates } from './body-map-state.ts';

  interface Props {
    selected?: BodyZone | null;
    zoneStates?: ZoneStates;
    disabled?: boolean;
    onselect?: (zone: BodyZone) => void;
  }

  let {
    selected = $bindable(null),
    zoneStates = {},
    disabled = false,
    onselect,
  }: Props = $props();

  let hoveredZone = $state<BodyZone | null>(null);
  let focusedZone = $state<BodyZone | null>(null);

  const highlightedZone = $derived(hoveredZone ?? focusedZone);
  const selectedLabel = $derived(selected == null ? '' : BODY_ZONE_LABELS[selected]);

  function choose(zone: BodyZone): void {
    if (!isZoneInteractive(zone, { disabled, zoneStates })) {
      return;
    }

    selected = nextSelection(selected, zone, { disabled, zoneStates });
    onselect?.(zone);
  }

  function handleKeydown(event: KeyboardEvent, zone: BodyZone): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(zone);
    } else if (event.key === ' ') {
      event.preventDefault();
    }
  }

  function handleKeyup(event: KeyboardEvent, zone: BodyZone): void {
    if (event.key === ' ') {
      event.preventDefault();
      choose(zone);
    }
  }
</script>

<div class="flex flex-col items-center gap-4">
  <div class="flex w-full flex-col items-center justify-center gap-6 md:flex-row md:gap-10">
    {#each BODY_MAP_VIEWS as view (view.id)}
      <svg
        class="h-auto w-full max-w-[220px] touch-manipulation"
        viewBox={view.viewBox}
        role="group"
        aria-label={view.label}
      >
        <path class="silhouette" d={view.silhouettePath} />
        {#each view.regions as region (region.id)}
          {@const state = zoneStates[region.zone]}
          {@const caption = zoneCaption(region.zone)}
          {@const interactive = isZoneInteractive(region.zone, { disabled, zoneStates })}
          <g
            class="region"
            role="button"
            tabindex="0"
            data-region-id={region.id}
            data-zone={region.zone}
            data-highlighted={highlightedZone === region.zone}
            data-selected={selected === region.zone}
            data-disabled={!interactive}
            aria-label={regionAccessibleName(region.zone, view.label, state)}
            aria-pressed={selected === region.zone}
            aria-disabled={!interactive}
            onclick={() => choose(region.zone)}
            onkeydown={(event) => handleKeydown(event, region.zone)}
            onkeyup={(event) => handleKeyup(event, region.zone)}
            onpointerenter={() => (hoveredZone = region.zone)}
            onpointerleave={() => (hoveredZone = null)}
            onfocus={() => (focusedZone = region.zone)}
            onblur={() => (focusedZone = null)}
          >
            {#if caption != null}
              <title>{caption}</title>
            {/if}
            {#if region.hitPathData != null}
              <path class="touch-target" d={region.hitPathData} />
            {/if}
            <path class="shape" d={region.pathData} />
            {#if state?.badge}
              <text class="badge" x={region.anchor.x} y={region.anchor.y} aria-hidden="true">{state.badge}</text>
            {/if}
          </g>
        {/each}
      </svg>
    {/each}
  </div>

  <p
    class="min-h-8 rounded-full bg-blue-700 px-4 py-1 text-sm font-medium text-white empty:hidden"
    data-testid="selected-chip"
  >{selectedLabel}</p>
  {#if selected == null}
    <p class="text-sm text-slate-700">Select a body zone</p>
  {/if}
  <p class="sr-only" role="status" aria-live="polite">
    {selected == null ? '' : `${selectedLabel} selected`}
  </p>
</div>

<style>
  .silhouette {
    fill: #e2e8f0;
    stroke: #64748b;
    stroke-width: 1;
  }

  .region {
    cursor: pointer;
    outline: none;
  }

  .region .shape {
    fill: #f8fafc;
    stroke: #334155;
    stroke-width: 1.5;
  }

  .region .touch-target {
    fill: transparent;
    stroke: none;
  }

  .region[data-highlighted='true'] .shape {
    fill: #bfdbfe;
  }

  .region[data-selected='true'] .shape {
    fill: #1d4ed8;
    stroke: #172554;
    stroke-width: 3;
  }

  .region[data-disabled='true'] {
    cursor: not-allowed;
  }

  .region[data-disabled='true'] .shape {
    fill: #cbd5e1;
    stroke-dasharray: 3 3;
  }

  .region:focus-visible .shape {
    stroke: #b45309;
    stroke-width: 3.5;
    stroke-dasharray: 6 3;
  }

  .badge {
    font-size: 11px;
    font-weight: 600;
    fill: #0f172a;
    text-anchor: middle;
    dominant-baseline: middle;
    pointer-events: none;
  }

  .region[data-selected='true'] .badge {
    fill: #ffffff;
  }

  @media (prefers-reduced-motion: no-preference) {
    .region .shape {
      transition: fill 120ms ease-out;
    }
  }
</style>
