<script lang="ts">
  import { onMount } from 'svelte';
  import { connectErrorMessage } from './connect-errors.ts';
  import { requirementLabels } from './requirement-labels.ts';
  import type { ConnectApi, ConnectStatus } from './connect-api.ts';

  interface Props {
    api: ConnectApi;
    redirect: (url: string) => void;
    returned?: boolean;
    refreshed?: boolean;
    pollIntervalMs?: number;
    maxPolls?: number;
    onrefreshattempted?: () => void;
  }

  const BADGES: Record<ConnectStatus, { label: string; classes: string }> = {
    NOT_STARTED: { label: 'Not started', classes: 'bg-slate-100 text-slate-800' },
    INCOMPLETE: { label: 'Setup incomplete', classes: 'bg-amber-100 text-amber-900' },
    RESTRICTED: { label: 'Action needed', classes: 'bg-red-100 text-red-800' },
    READY: { label: 'Ready for payouts', classes: 'bg-green-100 text-green-900' },
  };

  const ACTIONS: Record<Exclude<ConnectStatus, 'READY'>, string> = {
    NOT_STARTED: 'Set up payouts',
    INCOMPLETE: 'Continue setup',
    RESTRICTED: 'Fix payout details',
  };

  let {
    api,
    redirect,
    returned = false,
    refreshed = false,
    pollIntervalMs = 2_000,
    maxPolls = 5,
    onrefreshattempted,
  }: Props = $props();

  let status = $state<ConnectStatus | null>(null);
  let requirementsDue = $state<string[] | null>(null);
  let errorMessage = $state<string | null>(null);
  let requesting = $state(false);
  let confirming = $state(false);
  let stillPending = $state(false);

  const dueLabels = $derived(
    (status === 'INCOMPLETE' || status === 'RESTRICTED') && requirementsDue != null
      ? requirementLabels(requirementsDue)
      : [],
  );
  const busy = $derived(requesting || confirming);

  let destroyed = false;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      pendingTimer = setTimeout(resolve, ms);
    });
  }

  function isHttps(url: string): boolean {
    try {
      return new URL(url).protocol === 'https:';
    } catch {
      return false;
    }
  }

  async function loadStatus(): Promise<boolean> {
    let result: Awaited<ReturnType<ConnectApi['fetchConnectStatus']>>;

    try {
      result = await api.fetchConnectStatus();
    } catch {
      result = { ok: false, status: 502, code: 'request_failed' };
    }

    if (destroyed) {
      return false;
    }

    if (!result.ok) {
      errorMessage = connectErrorMessage(result.code, result.status);

      return false;
    }

    status = result.value.status;
    requirementsDue = result.value.requirementsDue;
    errorMessage = null;

    return true;
  }

  async function retryStatus(): Promise<void> {
    errorMessage = null;
    await loadStatus();
  }

  async function confirmReturn(): Promise<void> {
    confirming = true;

    for (let attempt = 0; attempt < maxPolls; attempt++) {
      const loaded = await loadStatus();

      if (destroyed) {
        return;
      }

      if (!loaded || status === 'READY') {
        confirming = false;

        return;
      }

      if (attempt < maxPolls - 1) {
        await sleep(pollIntervalMs);

        if (destroyed) {
          return;
        }
      }
    }

    confirming = false;
    stillPending = true;
  }

  async function startOnboarding(): Promise<void> {
    requesting = true;
    errorMessage = null;

    let result: Awaited<ReturnType<ConnectApi['requestOnboardingLink']>>;

    try {
      result = await api.requestOnboardingLink();
    } catch {
      result = { ok: false, status: 502, code: 'request_failed' };
    }

    if (destroyed) {
      return;
    }

    if (result.ok && isHttps(result.value.url)) {
      redirect(result.value.url);

      return;
    }

    errorMessage = result.ok
      ? connectErrorMessage('invalid_onboarding_link')
      : connectErrorMessage(result.code, result.status);
    requesting = false;
  }

  async function autoRefresh(): Promise<void> {
    await startOnboarding();
    onrefreshattempted?.();
  }

  onMount(() => {
    if (refreshed) {
      void loadStatus();
      void autoRefresh();
    } else if (returned) {
      void confirmReturn();
    } else {
      void loadStatus();
    }

    return () => {
      destroyed = true;
      clearTimeout(pendingTimer);
    };
  });
</script>

<section class="flex flex-col gap-4" aria-labelledby="payouts-heading">
  <h2 id="payouts-heading" class="text-base font-medium">Payout account</h2>

  {#if status != null}
    <p class="flex items-center gap-2 text-sm">
      <span>Status:</span>
      <span class="rounded px-2 py-0.5 font-medium {BADGES[status].classes}">
        {BADGES[status].label}
      </span>
    </p>
  {/if}

  <p role="status" aria-live="polite" class="min-h-5 text-sm text-slate-700">
    {#if confirming}
      Confirming your setup with Stripe...
    {:else if requesting}
      Opening Stripe...
    {:else if stillPending}
      Your setup is still being confirmed. Reload this page in a minute to check again.
    {:else if status == null && errorMessage == null}
      Loading payout status...
    {:else if status === 'READY'}
      You can receive payouts.
    {/if}
  </p>

  {#if dueLabels.length > 0}
    <div class="text-sm text-slate-700">
      <p id="requirements-heading" class="font-medium">Stripe still needs:</p>
      <ul class="mt-1 list-disc pl-5" aria-labelledby="requirements-heading">
        {#each dueLabels as label (label)}
          <li>{label}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if errorMessage != null}
    <p role="alert" class="text-sm text-red-700">{errorMessage}</p>
  {/if}

  {#if status == null && errorMessage != null}
    <div>
      <button
        type="button"
        class="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        onclick={retryStatus}
      >
        Try again
      </button>
    </div>
  {:else if status != null && status !== 'READY'}
    <div>
      <button
        type="button"
        class="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
        disabled={busy}
        onclick={startOnboarding}
      >
        {ACTIONS[status]}
      </button>
    </div>
  {/if}
</section>
