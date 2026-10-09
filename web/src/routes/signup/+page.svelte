<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import SignupForm from '../../lib/auth/SignupForm.svelte';
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
  <h1 class="text-lg font-semibold text-slate-900">Create account</h1>
  <SignupForm {session} />
  <p class="text-sm text-slate-700">
    Already have an account?
    <a class="underline" href={`/login?next=${encodeURIComponent(next)}`}>Sign in</a>
  </p>
</main>
