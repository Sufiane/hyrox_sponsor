<script lang="ts">
  import { formatRaceDate } from './format-race-date.ts';
  import type { PublicRaceListItem } from './results-types.ts';

  interface Props {
    races: PublicRaceListItem[];
    nextCursor: string | null;
  }

  let { races, nextCursor }: Props = $props();
</script>

{#if races.length === 0}
  <p class="text-sm text-slate-700">No race results have been published yet.</p>
{:else}
  <ul class="flex flex-col divide-y divide-slate-300 border-y border-slate-300">
    {#each races as race (race.id)}
      <li>
        <a
          class="flex flex-col gap-1 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:flex-row sm:items-baseline sm:justify-between"
          href={`/results/${encodeURIComponent(race.id)}`}
        >
          <span class="flex flex-col">
            <span class="font-medium text-slate-900 underline">{race.name}</span>
            <span class="text-sm text-slate-700">
              {race.location} &middot; {formatRaceDate(race.date, race.timezone)}
            </span>
          </span>
          <span class="text-sm text-slate-700">
            {race.resultCount}
            {race.resultCount === 1 ? 'result' : 'results'}, {race.verifiedCount} verified
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

{#if nextCursor != null}
  <p class="mt-4">
    <a class="text-sm underline" href={`/results?cursor=${encodeURIComponent(nextCursor)}`}>
      Next races
    </a>
  </p>
{/if}
