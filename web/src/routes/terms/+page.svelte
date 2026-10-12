<script lang="ts">
  import { TOS_VERSION } from '@hyrox-sponsor/shared/tos-version';
  import { TOS_DRAFT_NOTICE, TOS_SECTIONS, TOS_TITLE } from '../../lib/legal/terms.ts';
  import { PRIMARY_BUTTON_CLASS } from '../../lib/auth/auth-classes.ts';
</script>

<svelte:head>
  <title>{TOS_TITLE}</title>
</svelte:head>

<main class="mx-auto flex max-w-2xl flex-col gap-8 p-6 pb-16">
  <header class="flex flex-col gap-3">
    <h1 class="text-2xl font-semibold text-slate-900">{TOS_TITLE}</h1>
    <p class="text-sm text-slate-700">Version <span class="font-mono">{TOS_VERSION}</span></p>
    {#if TOS_DRAFT_NOTICE != null}
      <p
        role="note"
        class="rounded border border-amber-700 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
      >
        {TOS_DRAFT_NOTICE}
      </p>
    {/if}
  </header>

  <nav aria-label="Contents" class="flex flex-col gap-2">
    <p class="text-sm font-medium text-slate-900">Contents</p>
    <ol class="list-decimal space-y-1 pl-5 text-sm text-slate-700 marker:text-slate-500">
      {#each TOS_SECTIONS as section (section.id)}
        <li>
          <a
            class="underline underline-offset-2 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            href={`#${section.id}`}>{section.heading}</a
          >
        </li>
      {/each}
    </ol>
  </nav>

  <div class="flex flex-col gap-8">
    {#each TOS_SECTIONS as section, index (section.id)}
      <section
        id={section.id}
        aria-labelledby={`${section.id}-heading`}
        class="flex scroll-mt-6 flex-col gap-2"
      >
        <h2 id={`${section.id}-heading`} class="text-lg font-semibold text-slate-900">
          {index + 1}. {section.heading}
        </h2>
        {#each section.paragraphs as paragraph}
          <p class="text-base leading-relaxed text-slate-800">{paragraph}</p>
        {/each}
      </section>
    {/each}
  </div>

  <footer class="border-t border-slate-300 pt-6">
    <a
      class={`inline-block no-underline ${PRIMARY_BUTTON_CLASS}`}
      href="/signup">Back to create account</a
    >
  </footer>
</main>
