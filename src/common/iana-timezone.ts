import type { Brand } from './brand.js';

export type IanaTimezone = Brand<string, 'IanaTimezone'>;

export function ianaTimezone(value: string): IanaTimezone {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error(`Invalid IANA timezone: "${value}"`);
    }

    throw error;
  }

  return value as IanaTimezone;
}
