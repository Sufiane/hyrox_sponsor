<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import AuthGate from '../../../../lib/auth/AuthGate.svelte';
  import { session } from '../../../../lib/auth/session.svelte.ts';
  import { authedResultSubmitApi } from '../../../../lib/results/authed-results-api.ts';
  import ResultSubmitForm from '../../../../lib/results/ResultSubmitForm.svelte';

  const api = authedResultSubmitApi();
</script>

<svelte:head>
  <title>Submit race result</title>
</svelte:head>

<AuthGate {session} {goto}>
  <main class="mx-auto flex max-w-md flex-col gap-6 p-6 text-slate-900">
    <header class="flex flex-col gap-1">
      <p class="text-sm"><a class="underline" href="/account/entries">My race entries</a></p>
      <h1 class="text-lg font-semibold">Your race result</h1>
      <p class="text-sm text-slate-700">
        Enter your finish time and a photo of the finish clock. Staff review every result. Until
        then it shows as unverified.
      </p>
    </header>

    {#key page.params.raceEntryId}
      <ResultSubmitForm raceEntryId={page.params.raceEntryId ?? ''} {api} />
    {/key}
  </main>
</AuthGate>
