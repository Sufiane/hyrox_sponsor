<script lang="ts">
  import RaceList from '../../lib/results/RaceList.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Race results</title>
</svelte:head>

<main class="mx-auto flex max-w-3xl flex-col gap-6 p-6 text-slate-900">
  <header class="flex flex-col gap-1">
    <p class="text-sm"><a class="underline" href="/">Home</a></p>
    <h1 class="text-lg font-semibold">Race results</h1>
    <p class="text-sm text-slate-700">
      Finish times are reported by athletes. Only times confirmed by staff are ranked.
    </p>
  </header>

  <RaceList races={data.races} nextCursor={data.nextCursor} />
</main>
