<script lang="ts">
  import { goto } from '$app/navigation';
  import AuthGate from '../../../lib/auth/AuthGate.svelte';
  import { session } from '../../../lib/auth/session.svelte.ts';
  import { authedResultSubmitApi } from '../../../lib/results/authed-results-api.ts';
  import EntryList from '../../../lib/results/EntryList.svelte';
  import { resultErrorMessage } from '../../../lib/results/result-errors.ts';
  import type { OwnEntry } from '../../../lib/results/results-types.ts';

  const api = authedResultSubmitApi();

  let entries = $state<OwnEntry[] | null>(null);
  let loadError = $state<string | null>(null);

  async function loadEntries(): Promise<void> {
    loadError = null;

    try {
      const result = await api.listOwnEntries();

      if (result.ok) {
        entries = result.value.items;
      } else {
        loadError = resultErrorMessage(result.code, result.status);
      }
    } catch {
      loadError = resultErrorMessage('request_failed');
    }
  }

  $effect(() => {
    if (session.status === 'authenticated') {
      void loadEntries();
    }
  });
</script>

<svelte:head>
  <title>My race entries</title>
</svelte:head>

<AuthGate {session} {goto}>
  <main class="mx-auto flex max-w-4xl flex-col gap-6 p-6 text-slate-900">
    <header class="flex flex-col gap-1">
      <p class="text-sm"><a class="underline" href="/">Home</a></p>
      <h1 class="text-lg font-semibold">My race entries</h1>
    </header>

    {#if loadError != null}
      <p role="alert" class="text-sm text-red-700">{loadError}</p>
    {:else if entries == null}
      <p role="status" class="text-sm text-slate-700">Loading your entries...</p>
    {:else}
      <EntryList {entries} />
    {/if}
  </main>
</AuthGate>
