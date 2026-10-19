import type { Brand } from './brand';
import { InvalidValueError } from './domain-error';

export type AthleteId = Brand<string, 'AthleteId'>;
export type RaceId = Brand<string, 'RaceId'>;
export type AuctionId = Brand<string, 'AuctionId'>;
export type BidId = Brand<string, 'BidId'>;
export type BidderId = Brand<string, 'BidderId'>;
export type RaceEntryId = Brand<string, 'RaceEntryId'>;
export type RaceResultId = Brand<string, 'RaceResultId'>;
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

export function raceId(value: string): RaceId {
  return validatedId(value, 'race_id_invalid') as RaceId;
}

export function raceResultId(value: string): RaceResultId {
  return validatedId(value, 'race_result_id_invalid') as RaceResultId;
}

export function raceEntryId(value: string): RaceEntryId {
  return validatedId(value, 'race_entry_id_invalid') as RaceEntryId;
}

export function staffId(value: string): StaffId {
  return validatedId(value, 'staff_id_invalid') as StaffId;
}

export function auctionId(value: string): AuctionId {
  return validatedId(value, 'auction_id_invalid') as AuctionId;
}

export function bidderId(value: string): BidderId {
  return validatedId(value, 'bidder_id_invalid') as BidderId;
}
