import { InvalidValueError } from './domain-error';
import type { Brand } from './brand';

export type IanaTimezone = Brand<string, 'IanaTimezone'>;

export function ianaTimezone(value: string): IanaTimezone {
  let canonical: string;

  try {
    canonical = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch (error) {
    if (error instanceof RangeError) {
      throw new InvalidValueError('iana_timezone_invalid');
    }

    throw error;
  }

  return canonical as IanaTimezone;
}
