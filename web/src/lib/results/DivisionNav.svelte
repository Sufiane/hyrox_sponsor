<script lang="ts">
  import { divisionLabel } from './division-label.ts';
  import type { PublicDivisionSummary } from './results-types.ts';

  interface Props {
    divisions: PublicDivisionSummary[];
    current: string | null;
    hrefFor: (division: string) => string;
  }

  let { divisions, current, hrefFor }: Props = $props();
</script>

<nav aria-label="Divisions">
  <ul class="flex flex-wrap gap-2">
    {#each divisions as entry (entry.division)}
      {@const active = entry.division === current}
      <li>
        <a
          class={`inline-flex items-baseline gap-1.5 rounded border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
            active
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-500 text-slate-900 hover:bg-slate-50'
          }`}
          href={hrefFor(entry.division)}
          aria-current={active ? 'page' : undefined}
        >
          {divisionLabel(entry.division)}
          <span class={active ? 'text-slate-200' : 'text-slate-700'}>{entry.resultCount}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>
