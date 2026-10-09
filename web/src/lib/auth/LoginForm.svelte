<script lang="ts">
  import { ERROR_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from './auth-classes.ts';
  import { authErrorMessage } from './auth-errors.ts';
  import { AuthApiError } from './auth-types.ts';
  import type { Session } from './session.svelte.ts';
  import { validateLogin } from './validation.ts';
  import type { FieldErrors } from './validation.ts';

  interface Props {
    session: Session;
    onsuccess?: () => void;
  }

  let { session, onsuccess }: Props = $props();

  let email = $state('');
  let password = $state('');
  let fieldErrors = $state<FieldErrors>({});
  let serverError = $state<string | null>(null);
  let pending = $state(false);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    serverError = null;
    fieldErrors = validateLogin({ email, password });

    if (Object.keys(fieldErrors).length > 0) {
      return;
    }

    pending = true;

    try {
      await session.login(email.trim(), password);
      onsuccess?.();
    } catch (error) {
      serverError =
        error instanceof AuthApiError
          ? authErrorMessage(error.code, error.status)
          : authErrorMessage('request_failed');
    } finally {
      pending = false;
    }
  }
</script>

<form class="flex w-full max-w-sm flex-col gap-4" novalidate onsubmit={handleSubmit}>
  <div class="flex flex-col gap-1">
    <label for="login-email" class={LABEL_CLASS}>Email</label>
    <input
      id="login-email"
      class={INPUT_CLASS}
      type="email"
      autocomplete="email"
      bind:value={email}
      aria-invalid={fieldErrors.email != null}
      aria-describedby={fieldErrors.email != null ? 'login-email-error' : undefined}
    />
    {#if fieldErrors.email != null}
      <p id="login-email-error" class={ERROR_CLASS}>{fieldErrors.email}</p>
    {/if}
  </div>

  <div class="flex flex-col gap-1">
    <label for="login-password" class={LABEL_CLASS}>Password</label>
    <input
      id="login-password"
      class={INPUT_CLASS}
      type="password"
      autocomplete="current-password"
      bind:value={password}
      aria-invalid={fieldErrors.password != null}
      aria-describedby={fieldErrors.password != null ? 'login-password-error' : undefined}
    />
    {#if fieldErrors.password != null}
      <p id="login-password-error" class={ERROR_CLASS}>{fieldErrors.password}</p>
    {/if}
  </div>

  <div role="alert">
    {#if serverError != null}
      <p class={ERROR_CLASS}>{serverError}</p>
    {/if}
  </div>

  <button type="submit" class={PRIMARY_BUTTON_CLASS} disabled={pending}>
    {pending ? 'Signing in...' : 'Sign in'}
  </button>
</form>
