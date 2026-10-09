<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Session } from './session.svelte.ts';

  interface Props {
    session: Session;
    goto: (url: string) => void;
    children: Snippet;
    loginPath?: string;
  }

  let { session, goto, children, loginPath = '/login' }: Props = $props();

  let redirected = false;

  $effect(() => {
    if (session.status !== 'anonymous') {
      redirected = false;

      return;
    }

    if (redirected) {
      return;
    }

    redirected = true;
    goto(`${loginPath}?next=${encodeURIComponent(location.pathname + location.search)}`);
  });
</script>

{#if session.status === 'loading'}
  <p role="status" class="p-6 text-sm text-slate-700">Checking session...</p>
{:else if session.status === 'authenticated'}
  {@render children()}
{/if}
