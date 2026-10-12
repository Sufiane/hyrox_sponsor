import { BATCH_SIZE, processInBatches } from './process-in-batches';

type Row = { id: number };

function rows(from: number, count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({ id: from + index }));
}

describe('processInBatches', () => {
  let handled: Row[][];
  let cursors: Array<number | null>;

  beforeEach(() => {
    handled = [];
    cursors = [];
  });

  describe('when the first page is full and the second is short', () => {
    it('fetches from the last cursor and stops', async () => {
      const pages = [rows(1, BATCH_SIZE), rows(BATCH_SIZE + 1, 3)];

      await processInBatches<Row, number>(
        (after) => {
          cursors.push(after);

          return Promise.resolve(pages.shift() ?? []);
        },
        (row) => row.id,
        (items) => {
          handled.push(items);

          return Promise.resolve();
        },
      );

      expect(cursors).toEqual([null, BATCH_SIZE]);
      expect(handled.map((page) => page.length)).toEqual([BATCH_SIZE, 3]);
    });
  });

  describe('when the first page is empty', () => {
    it('never calls the handler', async () => {
      await processInBatches<Row, number>(
        () => Promise.resolve([]),
        (row) => row.id,
        (items) => {
          handled.push(items);

          return Promise.resolve();
        },
      );

      expect(handled).toEqual([]);
    });
  });
});
