<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import LoginForm from '../../lib/auth/LoginForm.svelte';
  import { safeNext } from '../../lib/auth/safe-next.ts';
  import { session } from '../../lib/auth/session.svelte.ts';

  const next = $derived(safeNext(page.url.searchParams.get('next')));

  $effect(() => {
    if (session.status === 'authenticated') {
      void goto(next);
    }
  });
</script>

<main class="mx-auto flex max-w-sm flex-col gap-6 p-6">
  <h1 class="text-lg font-semibold text-slate-900">Sign in</h1>
  <LoginForm {session} />
  <p class="text-sm text-slate-700">
    No account?
    <a class="underline" href={`/signup?next=${encodeURIComponent(next)}`}>Create one</a>
  </p>
</main>
