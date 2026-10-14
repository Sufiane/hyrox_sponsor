<script lang="ts">
  import { divisionLabel } from './division-label.ts';
  import { formatRaceDate } from './format-race-date.ts';
  import type { BibVerificationStatus, OwnEntry, ResultStatus } from './results-types.ts';

  interface Props {
    entries: OwnEntry[];
  }

  let { entries }: Props = $props();

  const STATUS_LABELS: Record<BibVerificationStatus | ResultStatus, string> = {
    PENDING: 'Awaiting review',
    VERIFIED: 'Verified',
    REJECTED: 'Rejected',
  };

  const HEAD = 'px-3 py-2 text-left text-sm font-medium text-slate-900';
  const CELL = 'px-3 py-2 text-slate-900';
</script>

{#if entries.length === 0}
  <div class="flex max-w-md flex-col gap-2 text-sm text-slate-700">
    <p>You have no race entries yet.</p>
    <p>
      Entries are created when you log a race. Logging a race from the website is not available
      yet.
    </p>
  </div>
{:else}
  <div class="overflow-x-auto">
    <table class="w-full border-collapse text-sm">
      <caption class="sr-only">Your race entries</caption>
      <thead class="border-b border-slate-500">
        <tr>
          <th scope="col" class={HEAD}>Race</th>
          <th scope="col" class={HEAD}>Date</th>
          <th scope="col" class={HEAD}>Division</th>
          <th scope="col" class={HEAD}>Bib</th>
          <th scope="col" class={HEAD}>Result</th>
          <th scope="col" class={HEAD}><span class="sr-only">Action</span></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-300">
        {#each entries as entry (entry.raceEntryId)}
          <tr>
            <th scope="row" class={`${CELL} text-left font-medium`}>{entry.raceName}</th>
            <td class={CELL}>{formatRaceDate(entry.raceDate, entry.timezone)}</td>
            <td class={CELL}>{divisionLabel(entry.division)}</td>
            <td class={CELL}>{STATUS_LABELS[entry.bibVerificationStatus]}</td>
            <td class={CELL}>
              {entry.resultStatus == null ? 'No result' : STATUS_LABELS[entry.resultStatus]}
            </td>
            <td class={CELL}>
              <a
                class="underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                href={`/results/submit/${encodeURIComponent(entry.raceEntryId)}`}
                aria-label={`${entry.resultStatus == null ? 'Add' : 'Edit'} result for ${entry.raceName}`}
              >
                {entry.resultStatus == null ? 'Add result' : 'Edit result'}
              </a>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
