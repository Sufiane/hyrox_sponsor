<script lang="ts">
  import { goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import AuthGate from '../../../lib/auth/AuthGate.svelte';
  import { session } from '../../../lib/auth/session.svelte.ts';
  import { authedConnectApi } from '../../../lib/connect/authed-connect-api.ts';
  import PayoutsPanel from '../../../lib/connect/PayoutsPanel.svelte';

  const api = authedConnectApi();

  function redirect(url: string): void {
    window.location.assign(url);
  }

  function stripRefreshParam(): void {
    const url = new URL(page.url.href);

    url.searchParams.delete('refresh');
    replaceState(`${url.pathname}${url.search}`, {});
  }
</script>

<svelte:head>
  <title>Payouts</title>
</svelte:head>

<AuthGate {session} {goto}>
  <main class="mx-auto flex max-w-md flex-col gap-6 p-6 text-slate-900">
    <header class="flex flex-col gap-1">
      <p class="text-sm"><a class="underline" href="/">Home</a></p>
      <h1 class="text-lg font-semibold">Payouts</h1>
      <p class="text-sm text-slate-700">
        Connect a payout account with Stripe so you can be paid for sponsorships.
      </p>
    </header>

    <PayoutsPanel
      {api}
      {redirect}
      onrefreshattempted={stripRefreshParam}
      returned={page.url.searchParams.get('return') === '1'}
      refreshed={page.url.searchParams.get('refresh') === '1'}
    />
  </main>
</AuthGate>
