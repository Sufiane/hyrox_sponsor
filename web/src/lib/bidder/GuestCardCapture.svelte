<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { BidderApi } from './bidder-api.ts';
  import { bidderErrorMessage } from './bidder-errors.ts';
  import type { BidderTokenStore } from './bidder-token-store.ts';
  import type { CardElementLike, CardSaveResult, StripeClient, StripeLoader } from './stripe-loader.ts';

  type Phase =
    'idle' | 'loading' | 'ready' | 'confirming' | 'saved' | 'declined' | 'error' | 'token_required' | 'unconfigured';

  interface Props {
    api: BidderApi;
    stripeLoader: StripeLoader;
    tokenStore: BidderTokenStore;
  }

  let { api, stripeLoader, tokenStore }: Props = $props();

  let phase = $state<Phase>('idle');
  let email = $state('');
  let message = $state<string | null>(null);
  let savedCard = $state<{ brand: string; last4: string } | null>(null);
  let container = $state<HTMLDivElement>();

  let stripe: StripeClient | null = null;
  let card: CardElementLike | null = null;
  let clientSecret = '';
  let destroyed = false;

  const showForm = $derived(
    phase === 'idle' || phase === 'error' || phase === 'declined' || phase === 'loading' || phase === 'token_required',
  );
  const cardVisible = $derived(phase === 'ready' || phase === 'confirming');
  const showMessage = $derived(
    message != null &&
      (phase === 'error' || phase === 'declined' || phase === 'token_required' || phase === 'unconfigured'),
  );

  function teardownCard(): void {
    card?.destroy();
    card = null;
  }

  function fail(next: Phase, text: string): void {
    message = text;
    phase = next;
  }

  async function start(): Promise<void> {
    phase = 'loading';
    message = null;
    teardownCard();

    try {
      stripe = await stripeLoader();
    } catch {
      if (!destroyed) {
        fail('error', bidderErrorMessage('request_failed'));
      }

      return;
    }

    if (destroyed) {
      return;
    }

    if (stripe == null) {
      fail('unconfigured', 'Card payments are not configured.');

      return;
    }

    const result = await api.createSetupIntent(email.trim(), tokenStore.get());

    if (destroyed) {
      return;
    }

    if (!result.ok) {
      if (result.code === 'bidder_token_required') {
        fail('token_required', bidderErrorMessage(result.code));

        return;
      }

      fail('error', bidderErrorMessage(result.code, result.status));

      return;
    }

    tokenStore.set(result.value.bidderToken, result.value.bidderTokenExpiresAt);
    clientSecret = result.value.clientSecret;
    phase = 'ready';
    await tick();

    if (destroyed) {
      return;
    }

    try {
      card = stripe.createCardElement();

      if (container != null) {
        card.mount(container);
      }
    } catch {
      fail('error', bidderErrorMessage('request_failed'));
    }
  }

  async function save(): Promise<void> {
    if (stripe == null || card == null) {
      return;
    }

    phase = 'confirming';

    let outcome: CardSaveResult;

    try {
      outcome = await stripe.saveCard(card, clientSecret);
    } catch {
      if (!destroyed) {
        fail('error', bidderErrorMessage('request_failed'));
      }

      return;
    }

    if (destroyed) {
      return;
    }

    if (outcome.ok) {
      savedCard = { brand: outcome.brand, last4: outcome.last4 };
      phase = 'saved';

      return;
    }

    fail('declined', outcome.message);
  }

  onDestroy((): void => {
    destroyed = true;
    teardownCard();
  });
</script>

<section class="flex flex-col gap-4">
  {#if showForm}
    <form
      class="flex flex-col gap-3"
      onsubmit={(event: SubmitEvent): void => {
        event.preventDefault();
        void start();
      }}
    >
      <label class="flex flex-col gap-1 text-sm">
        Email
        <input
          class="rounded border border-slate-300 px-3 py-2"
          type="email"
          autocomplete="email"
          required
          bind:value={email}
          disabled={phase === 'loading'}
        />
      </label>
      <button
        class="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        type="submit"
        disabled={phase === 'loading'}
      >
        {phase === 'loading' ? 'Loading…' : 'Continue'}
      </button>
    </form>
  {/if}

  <div class:hidden={!cardVisible} class="flex flex-col gap-3">
    <div class="rounded border border-slate-300 p-3" data-testid="card-element" bind:this={container}></div>
    {#if cardVisible}
      <button
        class="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        type="button"
        onclick={(): void => void save()}
        disabled={phase === 'confirming'}
      >
        {phase === 'confirming' ? 'Saving…' : 'Save card'}
      </button>
    {/if}
  </div>

  {#if phase === 'saved' && savedCard != null}
    <p class="text-sm text-green-900">Card saved: {savedCard.brand} ending {savedCard.last4}</p>
  {/if}

  {#if showMessage}
    <p class="text-sm text-red-800" role="alert">{message}</p>
  {/if}

  {#if phase === 'error' || phase === 'declined'}
    <button class="self-start underline" type="button" onclick={(): void => void start()}>Try again</button>
  {/if}
</section>
