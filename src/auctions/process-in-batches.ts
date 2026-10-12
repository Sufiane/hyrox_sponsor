export const BATCH_SIZE = 100;

export async function processInBatches<Item, Cursor>(
  fetchPage: (after: Cursor | null, limit: number) => Promise<Item[]>,
  cursorOf: (item: Item) => Cursor,
  handlePage: (items: Item[]) => Promise<void>,
): Promise<void> {
  let after: Cursor | null = null;
  let page = await fetchPage(after, BATCH_SIZE);

  while (page.length > 0) {
    await handlePage(page);

    if (page.length < BATCH_SIZE) {
      return;
    }

    after = cursorOf(page[page.length - 1]);
    page = await fetchPage(after, BATCH_SIZE);
  }
}
