import type { Brand } from './brand';
import { InvalidValueError } from './domain-error';

export type Seconds = Brand<number, 'Seconds'>;

export const MIN_FINISH_SECONDS = 1_800;
export const MAX_FINISH_SECONDS = 21_600;

export function seconds(value: number): Seconds {
  if (!Number.isInteger(value)) {
    throw new InvalidValueError('seconds_invalid');
  }

  if (value < MIN_FINISH_SECONDS || value > MAX_FINISH_SECONDS) {
    throw new InvalidValueError('finish_time_out_of_range');
  }

  return value as Seconds;
}
