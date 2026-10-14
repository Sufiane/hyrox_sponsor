<script lang="ts">
  import { formatFinishTime } from './format-finish-time.ts';
  import type { PublicResultItem } from './results-types.ts';

  interface Props {
    items: PublicResultItem[];
    total: number;
    page: number;
    pageSize: number;
    caption: string;
    hrefForPage: (page: number) => string;
  }

  let { items, total, page, pageSize, caption, hrefForPage }: Props = $props();

  const verifiedItems = $derived(items.filter((item) => item.verified));
  const unverifiedItems = $derived(items.filter((item) => !item.verified));
  const pageCount = $derived(Math.max(1, Math.ceil(total / pageSize)));

  const CELL = 'px-3 py-2';
  const HEAD = 'px-3 py-2 text-left text-sm font-medium text-slate-900';
  const LINK =
    'text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
</script>

{#if items.length === 0}
  <p class="text-sm text-slate-700">No results on this page.</p>
{/if}

{#if verifiedItems.length > 0}
  <div class="overflow-x-auto">
    <table class="w-full border-collapse text-sm">
      <caption class="sr-only">{caption}: ranked, verified results</caption>
      <thead class="border-b border-slate-500">
        <tr>
          <th scope="col" class={HEAD}>Rank</th>
          <th scope="col" class={HEAD}>Athlete</th>
          <th scope="col" class={`${HEAD} text-right`}>Time</th>
          <th scope="col" class={HEAD}>Status</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-300">
        {#each verifiedItems as item}
          <tr>
            <td class={`${CELL} tabular-nums`}>{item.rank}</td>
            <td class={`${CELL} text-slate-900`}>{item.displayName}</td>
            <td class={`${CELL} text-right tabular-nums text-slate-900`}>
              {formatFinishTime(item.finishTimeSeconds)}
            </td>
            <td class={CELL}>
              <span class="inline-flex items-center gap-1 text-green-800">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  class="size-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M3 8.5l3.2 3.2L13 4.8" />
                </svg>
                Verified
              </span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if unverifiedItems.length > 0}
  <section class="mt-8 flex flex-col gap-2" aria-labelledby="unverified-heading">
    <h3 id="unverified-heading" class="text-base font-semibold text-slate-900">
      Unverified results
    </h3>
    <p class="text-sm text-slate-700">
      Self-reported times still waiting for staff review. They are not ranked.
    </p>
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <caption class="sr-only">{caption}: unverified, unranked results</caption>
        <thead class="border-b border-slate-500">
          <tr>
            <th scope="col" class={HEAD}>Athlete</th>
            <th scope="col" class={`${HEAD} text-right`}>Time</th>
            <th scope="col" class={HEAD}>Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-300">
          {#each unverifiedItems as item}
            <tr>
              <td class={`${CELL} text-slate-900`}>{item.displayName}</td>
              <td class={`${CELL} text-right tabular-nums text-slate-900`}>
                {formatFinishTime(item.finishTimeSeconds)}
              </td>
              <td class={`${CELL} text-slate-700`}>Unverified</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/if}

{#if pageCount > 1}
  <nav class="mt-6 flex items-center gap-4" aria-label="Pagination">
    {#if page > 1}
      <a class={LINK} href={hrefForPage(page - 1)} rel="prev">Previous page</a>
    {/if}
    <span class="text-sm text-slate-700">Page {page} of {pageCount}</span>
    {#if page < pageCount}
      <a class={LINK} href={hrefForPage(page + 1)} rel="next">Next page</a>
    {/if}
  </nav>
{/if}
