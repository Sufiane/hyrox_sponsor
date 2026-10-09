<script lang="ts">
  import { goto } from '$app/navigation';
  import LogoutButton from '../lib/auth/LogoutButton.svelte';
  import { session } from '../lib/auth/session.svelte.ts';
</script>

<main class="mx-auto flex max-w-sm flex-col gap-4 p-6 text-slate-900">
  {#if session.status === 'authenticated'}
    <h1 class="text-lg font-semibold">
      {session.athlete == null ? 'Welcome' : `Welcome, ${session.athlete.name}`}
    </h1>
    <LogoutButton {session} onloggedout={() => void goto('/')} />
    <a class="underline" href="/dev/body-map">Body map dev harness</a>
  {:else if session.status === 'anonymous'}
    <h1 class="text-lg font-semibold">Hyrox Sponsor</h1>
    <p class="flex gap-4">
      <a class="underline" href="/login">Sign in</a>
      <a class="underline" href="/signup">Create account</a>
    </p>
  {:else}
    <p role="status" class="text-sm text-slate-700">Checking session...</p>
  {/if}
</main>
