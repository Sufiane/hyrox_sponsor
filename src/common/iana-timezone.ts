import type { Brand } from './brand.js';

export type IanaTimezone = Brand<string, 'IanaTimezone'>;

export function ianaTimezone(value: string): IanaTimezone {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error('iana_timezone_invalid');
    }

    throw error;
  }

  return value as IanaTimezone;
}
