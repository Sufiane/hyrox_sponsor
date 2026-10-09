import type { Brand } from './brand';
import { InvalidValueError } from './domain-error';

export type AthleteId = Brand<string, 'AthleteId'>;
export type RaceId = Brand<string, 'RaceId'>;
export type AuctionId = Brand<string, 'AuctionId'>;
export type BidId = Brand<string, 'BidId'>;
export type BidderId = Brand<string, 'BidderId'>;
export type RaceEntryId = Brand<string, 'RaceEntryId'>;
export type StaffId = Brand<string, 'StaffId'>;
export type StaffRefreshTokenId = Brand<string, 'StaffRefreshTokenId'>;

const ID_MAX_LENGTH = 64;

function validatedId(value: string, code: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > ID_MAX_LENGTH) {
    throw new InvalidValueError(code);
  }

  return trimmed;
}

export function athleteId(value: string): AthleteId {
  return validatedId(value, 'athlete_id_invalid') as AthleteId;
}

export function raceEntryId(value: string): RaceEntryId {
  return validatedId(value, 'race_entry_id_invalid') as RaceEntryId;
}

export function staffId(value: string): StaffId {
  return validatedId(value, 'staff_id_invalid') as StaffId;
}
