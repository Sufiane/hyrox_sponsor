import { formatFinishTime } from './format-finish-time.ts';

describe('formatFinishTime', () => {
  it('formats hours, minutes and seconds', () => {
    expect(formatFinishTime(3_725)).toBe('1:02:05');
  });

  it('keeps a zero hour', () => {
    expect(formatFinishTime(2_709)).toBe('0:45:09');
  });

  it('formats the maximum finish time', () => {
    expect(formatFinishTime(21_600)).toBe('6:00:00');
  });
});
