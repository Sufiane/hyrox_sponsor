import type { Brand } from './brand';
import { InvalidValueError } from './domain-error';

export type BidderToken = Brand<string, 'BidderToken'>;

const BIDDER_TOKEN_MAX_LENGTH = 2048;
const BIDDER_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function bidderToken(value: string): BidderToken {
  const trimmed = value.trim();

  if (trimmed.length > BIDDER_TOKEN_MAX_LENGTH || !BIDDER_TOKEN_PATTERN.test(trimmed)) {
    throw new InvalidValueError('bidder_token_invalid');
  }

  return trimmed as BidderToken;
}
