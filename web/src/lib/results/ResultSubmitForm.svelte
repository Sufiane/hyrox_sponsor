<script lang="ts">
  import {
    ERROR_CLASS,
    INPUT_CLASS,
    LABEL_CLASS,
    PRIMARY_BUTTON_CLASS,
  } from '../auth/auth-classes.ts';
  import { toTotalSeconds } from './finish-time-input.ts';
  import { photoProblem } from './photo-check.ts';
  import { resultErrorMessage } from './result-errors.ts';
  import type { ResultSubmitApi } from './result-submit-api.ts';
  import type { OwnResult } from './results-types.ts';

  interface Props {
    raceEntryId: string;
    api: ResultSubmitApi;
  }

  let { raceEntryId, api }: Props = $props();

  const TIME_INPUT_CLASS = `${INPUT_CLASS} tabular-nums`;

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let current = $state<OwnResult | null>(null);
  let hours = $state('');
  let minutes = $state('');
  let seconds = $state('');
  let proofUrl = $state('');
  let photo = $state<File | null>(null);
  let photoPreview = $state<string | null>(null);
  let formError = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let pending = $state(false);
  let photoInput = $state<HTMLInputElement | null>(null);

  function fillFrom(result: OwnResult): void {
    const total = result.finishTimeSeconds;

    hours = String(Math.floor(total / 3_600));
    minutes = String(Math.floor((total % 3_600) / 60));
    seconds = String(total % 60);
    proofUrl = result.proofUrl ?? '';
  }

  async function loadCurrent(): Promise<boolean> {
    const result = await api.getOwnResult(raceEntryId);

    if (result.ok) {
      current = result.value;
      fillFrom(result.value);
    } else if (result.status === 404) {
      current = null;
    } else if (loading) {
      loadError = resultErrorMessage(result.code, result.status);
    }

    loading = false;

    return result.ok || result.status === 404;
  }

  $effect(() => {
    void loadCurrent();
  });

  $effect(() => {
    const file = photo;

    if (file == null) {
      photoPreview = null;

      return;
    }

    const url = URL.createObjectURL(file);

    photoPreview = url;

    return () => URL.revokeObjectURL(url);
  });

  function handlePhoto(event: Event): void {
    const file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    const problem = file == null ? null : photoProblem(file);

    formError = problem;
    photo = problem == null ? file : null;

    if (problem != null) {
      (event.currentTarget as HTMLInputElement).value = '';
    }
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    formError = null;
    notice = null;

    const time = toTotalSeconds({ hours, minutes, seconds });

    if (!time.ok) {
      formError = time.error;

      return;
    }

    if (photo == null && current == null) {
      formError = resultErrorMessage('proof_photo_missing');

      return;
    }

    pending = true;

    try {
      const result = await api.submitResult(raceEntryId, {
        finishTimeSeconds: time.value,
        proofUrl,
        photo,
      });

      if (!result.ok) {
        formError = resultErrorMessage(result.code, result.status);

        return;
      }

      photo = null;

      if (photoInput != null) {
        photoInput.value = '';
      }

      notice = 'Result submitted. Staff will review it.';

      if (!(await loadCurrent())) {
        formError = 'Your result was saved, but we could not refresh its status. Reload the page.';
      }
    } catch {
      formError = resultErrorMessage('request_failed');
    } finally {
      pending = false;
    }
  }
</script>

{#if loading}
  <p role="status" class="text-sm text-slate-700">Loading your result...</p>
{:else if loadError != null}
  <p role="alert" class={ERROR_CLASS}>{loadError}</p>
{:else}
  <div class="flex w-full max-w-md flex-col gap-6">
    {#if current != null}
      <section aria-label="Current status" class="flex flex-col gap-1 rounded border border-slate-300 p-3 text-sm text-slate-900">
        {#if current.status === 'PENDING'}
          <p><strong>Awaiting review.</strong> Staff have not checked this time yet.</p>
        {:else if current.status === 'VERIFIED'}
          <p><strong>Verified.</strong></p>
          <p class="text-slate-700">
            Changing the time, photo or link sends this result back to review. It leaves the
            ranking until staff approve it again.
          </p>
        {:else}
          <p><strong>Rejected.</strong></p>
          {#if current.rejectionReason != null}
            <p>Reason: {current.rejectionReason}</p>
          {/if}
          <p class="text-slate-700">Fix the problem and submit again.</p>
        {/if}
        {#if !current.publicVisible && current.status !== 'REJECTED'}
          <p class="text-slate-700">
            Your result will appear publicly once your bib is verified.
          </p>
        {/if}
      </section>
    {/if}

    <form class="flex flex-col gap-5" novalidate onsubmit={handleSubmit}>
      <fieldset class="flex flex-col gap-2">
        <legend class={LABEL_CLASS}>Finish time</legend>
        <div class="flex gap-3">
          <div class="flex w-20 flex-col gap-1">
            <label for="result-hours" class="text-sm text-slate-700">Hours</label>
            <input id="result-hours" class={TIME_INPUT_CLASS} type="text" inputmode="numeric" autocomplete="off" bind:value={hours} />
          </div>
          <div class="flex w-20 flex-col gap-1">
            <label for="result-minutes" class="text-sm text-slate-700">Minutes</label>
            <input id="result-minutes" class={TIME_INPUT_CLASS} type="text" inputmode="numeric" autocomplete="off" bind:value={minutes} />
          </div>
          <div class="flex w-20 flex-col gap-1">
            <label for="result-seconds" class="text-sm text-slate-700">Seconds</label>
            <input id="result-seconds" class={TIME_INPUT_CLASS} type="text" inputmode="numeric" autocomplete="off" bind:value={seconds} />
          </div>
        </div>
      </fieldset>

      <div class="flex flex-col gap-1">
        <label for="result-photo" class={LABEL_CLASS}>Photo of the finish clock</label>
        <input
          id="result-photo"
          class={`${INPUT_CLASS} text-sm`}
          type="file"
          bind:this={photoInput}
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="result-photo-help"
          onchange={handlePhoto}
        />
        <p id="result-photo-help" class="text-sm text-slate-700">
          JPEG, PNG or WebP, up to 10 MB. Only staff can see it.
          {#if current != null}Leave empty to keep your current photo.{/if}
        </p>
        {#if photoPreview != null}
          <img src={photoPreview} alt="Selected finish clock" class="mt-1 max-h-48 w-fit rounded border border-slate-300" />
        {/if}
      </div>

      <div class="flex flex-col gap-1">
        <label for="result-url" class={LABEL_CLASS}>Link to the official result (optional)</label>
        <input id="result-url" class={INPUT_CLASS} type="url" autocomplete="off" aria-describedby="result-url-help" bind:value={proofUrl} />
        <p id="result-url-help" class="text-sm text-slate-700">
          Only staff see this link. Leaving it empty removes a saved link.
        </p>
      </div>

      <div role="alert">
        {#if formError != null}
          <p class={ERROR_CLASS}>{formError}</p>
        {/if}
      </div>
      <div role="status">
        {#if notice != null}
          <p class="text-sm text-green-800">{notice}</p>
        {/if}
      </div>

      <button type="submit" class={PRIMARY_BUTTON_CLASS} disabled={pending}>
        {pending ? 'Submitting...' : current == null ? 'Submit result' : 'Resubmit result'}
      </button>
    </form>
  </div>
{/if}
