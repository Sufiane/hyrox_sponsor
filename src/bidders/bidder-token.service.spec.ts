import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type MockInstance } from 'vitest';
import type { BidderId } from '../common/ids';
import type { BidderTokenConfig } from './bidder-token.config';
import { BidderTokenService } from './bidder-token.service';

const SECRET = 's'.repeat(32);
const config: BidderTokenConfig = { ttlSeconds: 900 };
const id = 'bidder-1' as BidderId;
const NOW = new Date('2026-11-15T12:00:00.000Z');

function buildService(secret: string = SECRET): BidderTokenService {
  return new BidderTokenService(new JwtService({ secret }), config);
}

function signRaw(payload: object, options: object = {}, secret: string = SECRET): Promise<string> {
  return new JwtService({ secret }).signAsync(payload, {
    algorithm: 'HS256',
    expiresIn: 900,
    audience: 'hyrox-bidder',
    issuer: 'hyrox-api',
    ...options,
  });
}

describe('BidderTokenService', () => {
  let service: BidderTokenService;
  let warn: MockInstance;

  beforeEach(() => {
    service = buildService();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
  });

  describe('when issuing a token', () => {
    beforeEach(() => {
      vi.useFakeTimers({ now: NOW });
    });

    it('verifies back to the same bidder id', async () => {
      const issued = await service.issue(id);

      await expect(service.verify(issued.token)).resolves.toBe(id);
    });

    it('expires after the configured ttl', async () => {
      const issued = await service.issue(id);

      expect(issued.expiresAt).toEqual(new Date(NOW.getTime() + 900_000));
    });
  });

  describe('when the token has expired', () => {
    it('rejects with bidder_token_required', async () => {
      vi.useFakeTimers({ now: NOW });

      const issued = await service.issue(id);

      vi.setSystemTime(new Date(NOW.getTime() + 901_000));

      await expect(service.verify(issued.token)).rejects.toThrow('bidder_token_required');
    });
  });

  describe('when the token is invalid', () => {
    it('rejects one signed with another secret', async () => {
      const token = await signRaw({ sub: id }, {}, 'x'.repeat(32));

      await expect(service.verify(token)).rejects.toThrow('bidder_token_required');
    });

    it('rejects one with another audience', async () => {
      const token = await signRaw({ sub: id }, { audience: 'hyrox-staff' });

      await expect(service.verify(token)).rejects.toThrow('bidder_token_required');
    });

    it('rejects one with another issuer', async () => {
      const token = await signRaw({ sub: id }, { issuer: 'other' });

      await expect(service.verify(token)).rejects.toThrow('bidder_token_required');
    });

    it('rejects one without a subject', async () => {
      const token = await signRaw({});

      await expect(service.verify(token)).rejects.toThrow('bidder_token_required');
    });

    it('rejects one signed with another algorithm', async () => {
      const token = await signRaw({ sub: id }, { algorithm: 'HS512' });

      await expect(service.verify(token)).rejects.toThrow('bidder_token_required');
    });

    it('rejects an unsigned token', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(
        JSON.stringify({ sub: id, aud: 'hyrox-bidder', iss: 'hyrox-api', exp: Math.floor(Date.now() / 1000) + 900 }),
      ).toString('base64url');

      await expect(service.verify(`${header}.${body}.`)).rejects.toThrow('bidder_token_required');
    });

    it('rejects garbage', async () => {
      await expect(service.verify('not-a-token')).rejects.toThrow('bidder_token_required');
    });

    it('rejects undefined', async () => {
      await expect(service.verify(undefined)).rejects.toThrow('bidder_token_required');
    });

    it('rejects an empty string', async () => {
      await expect(service.verify('  ')).rejects.toThrow('bidder_token_required');
    });
  });

  describe('when verification fails', () => {
    it('logs a warning without the token', async () => {
      const token = await signRaw({ sub: id }, {}, 'x'.repeat(32));

      await expect(service.verify(token)).rejects.toThrow();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    });
  });
});
