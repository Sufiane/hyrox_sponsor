import { InvalidValueError } from './domain-error';
import type { Brand } from './brand';

export type IanaTimezone = Brand<string, 'IanaTimezone'>;

export function ianaTimezone(value: string): IanaTimezone {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new InvalidValueError('iana_timezone_invalid');
    }

    throw error;
  }

  return value as IanaTimezone;
}
