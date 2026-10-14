<script lang="ts">
  import { divisionLabel } from '../../../lib/results/division-label.ts';
  import DivisionNav from '../../../lib/results/DivisionNav.svelte';
  import { formatRaceDate } from '../../../lib/results/format-race-date.ts';
  import Leaderboard from '../../../lib/results/Leaderboard.svelte';
  import { RESULTS_PAGE_SIZE } from '../../../lib/results/results-types.ts';

  let { data } = $props();

  const heading = $derived(data.division == null ? '' : divisionLabel(data.division));

  function divisionHref(division: string): string {
    return `?division=${encodeURIComponent(division)}`;
  }

  function pageHref(division: string, page: number): string {
    return `?division=${encodeURIComponent(division)}&page=${page}`;
  }
</script>

<svelte:head>
  <title>{data.race.name} results</title>
</svelte:head>

<main class="mx-auto flex max-w-3xl flex-col gap-6 p-6 text-slate-900">
  <header class="flex flex-col gap-1">
    <p class="text-sm"><a class="underline" href="/results">All races</a></p>
    <h1 class="text-lg font-semibold">{data.race.name}</h1>
    <p class="text-sm text-slate-700">
      {data.race.location} &middot; {formatRaceDate(data.race.date, data.race.timezone)}
    </p>
  </header>

  {#if data.results != null && data.division != null}
    {@const division = data.division}
    <DivisionNav
      divisions={data.race.divisions}
      current={data.division}
      hrefFor={divisionHref}
    />

    <section class="flex flex-col gap-3" aria-labelledby="division-heading">
      <h2 id="division-heading" class="text-base font-semibold">{heading}</h2>
      <p class="text-sm text-slate-700">
        {data.results.verifiedTotal} verified of {data.results.total}
        {data.results.total === 1 ? 'result' : 'results'}
      </p>
      <Leaderboard
        items={data.results.items}
        total={data.results.total}
        page={data.page}
        pageSize={RESULTS_PAGE_SIZE}
        caption={heading}
        hrefForPage={(page) => pageHref(division, page)}
      />
    </section>
  {:else}
    <p class="text-sm text-slate-700">No results have been published for this race.</p>
  {/if}
</main>
