<script lang="ts">
  import { createBidderApi } from '../../../lib/bidder/bidder-api.ts';
  import { createBidderTokenStore } from '../../../lib/bidder/bidder-token-store.ts';
  import GuestCardCapture from '../../../lib/bidder/GuestCardCapture.svelte';
  import { createStripeLoader } from '../../../lib/bidder/stripe-loader.ts';

  const api = createBidderApi(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000', fetch);
  const storage = typeof sessionStorage === 'undefined' ? null : sessionStorage;
  const tokenStore = createBidderTokenStore(storage, () => Date.now());
  const stripeLoader = createStripeLoader(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
</script>

<svelte:head>
  <title>Card capture (dev)</title>
</svelte:head>

<main class="mx-auto flex max-w-md flex-col gap-6 p-6 text-slate-900">
  <header class="flex flex-col gap-1">
    <h1 class="text-lg font-semibold">Guest card capture</h1>
    <p class="text-sm text-slate-700">Dev harness. Does not gate bidding.</p>
  </header>

  <GuestCardCapture {api} {stripeLoader} {tokenStore} />
</main>
