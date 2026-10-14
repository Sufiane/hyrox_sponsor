import { InvalidValueError } from '../common/domain-error';
import type { ProofUrl } from '../common/proof-url';

export const PROOF_URL_MAX_LENGTH = 500;

function parseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new InvalidValueError('proof_url_invalid');
  }
}

export function parseProofUrl(raw: string, allowedHosts: readonly string[]): ProofUrl {
  const trimmed = raw.trim();

  if (trimmed.length === 0 || trimmed.length > PROOF_URL_MAX_LENGTH) {
    throw new InvalidValueError('proof_url_invalid');
  }

  const url = parseUrl(trimmed);

  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    throw new InvalidValueError('proof_url_invalid');
  }

  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new InvalidValueError('proof_url_host_not_allowed');
  }

  return trimmed as ProofUrl;
}
