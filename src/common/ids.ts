import type { Brand } from './brand';
import { InvalidValueError } from './domain-error';

export type AthleteId = Brand<string, 'AthleteId'>;
export type RaceId = Brand<string, 'RaceId'>;
export type AuctionId = Brand<string, 'AuctionId'>;
export type BidId = Brand<string, 'BidId'>;
export type BidderId = Brand<string, 'BidderId'>;
export type RaceEntryId = Brand<string, 'RaceEntryId'>;

const ID_MAX_LENGTH = 64;

export function athleteId(value: string): AthleteId {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > ID_MAX_LENGTH) {
    throw new InvalidValueError('athlete_id_invalid');
  }

  return trimmed as AthleteId;
}
