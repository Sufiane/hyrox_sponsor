<script lang="ts">
  import { ERROR_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from './auth-classes.ts';
  import { authErrorMessage } from './auth-errors.ts';
  import { AuthApiError } from './auth-types.ts';
  import type { Session } from './session.svelte.ts';
  import { validateSignup } from './validation.ts';
  import type { FieldErrors } from './validation.ts';

  interface Props {
    session: Session;
    onsuccess?: () => void;
  }

  let { session, onsuccess }: Props = $props();

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let adultAttested = $state(false);
  let fieldErrors = $state<FieldErrors>({});
  let serverError = $state<string | null>(null);
  let pending = $state(false);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    serverError = null;
    fieldErrors = validateSignup({ name, email, password, confirmPassword, adultAttested });

    if (Object.keys(fieldErrors).length > 0) {
      return;
    }

    pending = true;

    try {
      await session.signup({ name: name.trim(), email: email.trim(), password, adultAttested });
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
    <label for="signup-name" class={LABEL_CLASS}>Name</label>
    <input
      id="signup-name"
      class={INPUT_CLASS}
      type="text"
      autocomplete="name"
      bind:value={name}
      aria-invalid={fieldErrors.name != null}
      aria-describedby={fieldErrors.name != null ? 'signup-name-error' : undefined}
    />
    {#if fieldErrors.name != null}
      <p id="signup-name-error" class={ERROR_CLASS}>{fieldErrors.name}</p>
    {/if}
  </div>

  <div class="flex flex-col gap-1">
    <label for="signup-email" class={LABEL_CLASS}>Email</label>
    <input
      id="signup-email"
      class={INPUT_CLASS}
      type="email"
      autocomplete="email"
      bind:value={email}
      aria-invalid={fieldErrors.email != null}
      aria-describedby={fieldErrors.email != null ? 'signup-email-error' : undefined}
    />
    {#if fieldErrors.email != null}
      <p id="signup-email-error" class={ERROR_CLASS}>{fieldErrors.email}</p>
    {/if}
  </div>

  <div class="flex flex-col gap-1">
    <label for="signup-password" class={LABEL_CLASS}>Password</label>
    <input
      id="signup-password"
      class={INPUT_CLASS}
      type="password"
      autocomplete="new-password"
      bind:value={password}
      aria-invalid={fieldErrors.password != null}
      aria-describedby={fieldErrors.password != null
        ? 'signup-password-error'
        : 'signup-password-hint'}
    />
    <p id="signup-password-hint" class="text-xs text-slate-700">10 to 128 characters.</p>
    {#if fieldErrors.password != null}
      <p id="signup-password-error" class={ERROR_CLASS}>{fieldErrors.password}</p>
    {/if}
  </div>

  <div class="flex flex-col gap-1">
    <label for="signup-confirm" class={LABEL_CLASS}>Confirm password</label>
    <input
      id="signup-confirm"
      class={INPUT_CLASS}
      type="password"
      autocomplete="new-password"
      bind:value={confirmPassword}
      aria-invalid={fieldErrors.confirmPassword != null}
      aria-describedby={fieldErrors.confirmPassword != null ? 'signup-confirm-error' : undefined}
    />
    {#if fieldErrors.confirmPassword != null}
      <p id="signup-confirm-error" class={ERROR_CLASS}>{fieldErrors.confirmPassword}</p>
    {/if}
  </div>

  <div class="flex flex-col gap-1">
    <label class="flex items-center gap-2 text-sm text-slate-900">
      <input
        type="checkbox"
        class="size-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        bind:checked={adultAttested}
        aria-invalid={fieldErrors.adultAttested != null}
        aria-describedby={fieldErrors.adultAttested != null ? 'signup-adult-error' : undefined}
      />
      I am 18 or older
    </label>
    {#if fieldErrors.adultAttested != null}
      <p id="signup-adult-error" class={ERROR_CLASS}>{fieldErrors.adultAttested}</p>
    {/if}
  </div>

  <div role="alert">
    {#if serverError != null}
      <p class={ERROR_CLASS}>{serverError}</p>
    {/if}
  </div>

  <button type="submit" class={PRIMARY_BUTTON_CLASS} disabled={pending}>
    {pending ? 'Creating account...' : 'Create account'}
  </button>
</form>
