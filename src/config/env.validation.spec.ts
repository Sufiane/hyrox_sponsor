import { Logger } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { validateEnv } from './env.validation';

const secret = 's'.repeat(32);
const databaseUrl = 'postgresql://user:pass@localhost:5435/db';
const storageEnv = {
  STORAGE_REGION: 'us-east-1',
  STORAGE_BUCKET: 'docs',
  STORAGE_ACCESS_KEY_ID: 'key',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
};
const staffSecret = 't'.repeat(32);
const validEnv = { JWT_SECRET: secret, STAFF_JWT_SECRET: staffSecret, DATABASE_URL: databaseUrl, ...storageEnv };

describe('validateEnv', () => {
  let error: MockInstance;

  beforeEach(() => {
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    error.mockRestore();
  });

  describe('when env is valid', () => {
    it('returns the parsed values', () => {
      const env = validateEnv({
        ...validEnv,
        JWT_ACCESS_TTL_SECONDS: '600',
        REFRESH_TOKEN_TTL_SECONDS: '3600',
        PORT: '4000',
        CORS_ORIGINS: 'http://a.test, http://b.test,',
      });

      expect(env).toMatchObject({
        JWT_SECRET: secret,
        DATABASE_URL: databaseUrl,
        JWT_ACCESS_TTL_SECONDS: 600,
        REFRESH_TOKEN_TTL_SECONDS: 3600,
        PORT: 4000,
        CORS_ORIGINS: ['http://a.test', 'http://b.test'],
      });
    });
  });

  describe('when optional variables are unset', () => {
    it('returns the defaults', () => {
      const env = validateEnv(validEnv);

      expect(env).toMatchObject({
        JWT_ACCESS_TTL_SECONDS: 900,
        REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
        STAFF_JWT_TTL_SECONDS: 900,
        STAFF_REFRESH_TOKEN_TTL_SECONDS: 604_800,
        PORT: 3000,
        CORS_ORIGINS: [],
      });
    });
  });

  describe('when JWT_SECRET is shorter than 32 chars', () => {
    it('throws env_invalid', () => {
      expect(() => validateEnv({ ...validEnv, JWT_SECRET: 'short' })).toThrow('env_invalid');
    });

    it('logs the invalid variable name', () => {
      expect(() => validateEnv({ ...validEnv, JWT_SECRET: 'short' })).toThrow();

      expect(error).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET'));
    });

    it('does not log the secret value', () => {
      expect(() => validateEnv({ ...validEnv, JWT_SECRET: 'short' })).toThrow();

      expect(JSON.stringify(error.mock.calls)).not.toContain('short');
    });
  });

  describe('when JWT_SECRET is missing', () => {
    it('throws env_invalid', () => {
      expect(() => validateEnv({ STAFF_JWT_SECRET: staffSecret, DATABASE_URL: databaseUrl, ...storageEnv })).toThrow(
        'env_invalid',
      );
    });
  });

  describe('when DATABASE_URL is missing or not a postgres URL', () => {
    it.each([undefined, '', 'mysql://localhost/db', 'localhost:5435'])('throws env_invalid for %j', (url) => {
      expect(() => validateEnv({ ...validEnv, DATABASE_URL: url })).toThrow('env_invalid');
    });
  });

  describe('when PORT is not a valid port', () => {
    it.each(['0', '70000', 'abc', '3000.5'])('throws env_invalid for %j', (port) => {
      expect(() => validateEnv({ ...validEnv, PORT: port })).toThrow('env_invalid');
    });
  });

  describe('when a TTL is not a positive integer', () => {
    it.each(['0', '-5', '1.5', 'abc', ''])('throws env_invalid for %j', (ttl) => {
      expect(() => validateEnv({ ...validEnv, JWT_ACCESS_TTL_SECONDS: ttl })).toThrow('env_invalid');
    });
  });

  describe('when a storage variable is missing', () => {
    it.each(Object.keys(storageEnv))('throws env_invalid without %s', (name) => {
      const raw: Record<string, unknown> = { ...validEnv };

      delete raw[name];

      expect(() => validateEnv(raw)).toThrow('env_invalid');
    });
  });

  describe('when STORAGE_ENDPOINT is set', () => {
    it('returns it', () => {
      const env = validateEnv({ ...validEnv, STORAGE_ENDPOINT: 'http://localhost:9005' });

      expect(env.STORAGE_ENDPOINT).toBe('http://localhost:9005');
    });
  });

  describe('when STORAGE_ENDPOINT is absent', () => {
    it('leaves it undefined', () => {
      expect(validateEnv(validEnv).STORAGE_ENDPOINT).toBeUndefined();
    });
  });

  describe('when STAFF_JWT_SECRET is missing', () => {
    it('throws env_invalid', () => {
      const raw: Record<string, unknown> = { ...validEnv };

      delete raw.STAFF_JWT_SECRET;

      expect(() => validateEnv(raw)).toThrow('env_invalid');
    });
  });

  describe('when STAFF_JWT_SECRET is shorter than 32 chars', () => {
    it('throws env_invalid', () => {
      expect(() => validateEnv({ ...validEnv, STAFF_JWT_SECRET: 'short' })).toThrow('env_invalid');
    });
  });

  describe('when STAFF_JWT_SECRET equals JWT_SECRET', () => {
    it('throws env_invalid', () => {
      expect(() => validateEnv({ ...validEnv, STAFF_JWT_SECRET: secret })).toThrow('env_invalid');
    });

    it('logs the reason', () => {
      expect(() => validateEnv({ ...validEnv, STAFF_JWT_SECRET: secret })).toThrow();

      expect(error).toHaveBeenCalledWith(expect.stringContaining('staff_jwt_secret_must_differ_from_jwt_secret'));
    });
  });

  describe('when the staff TTLs are set', () => {
    it('parses them', () => {
      const env = validateEnv({
        ...validEnv,
        STAFF_JWT_TTL_SECONDS: '3600',
        STAFF_REFRESH_TOKEN_TTL_SECONDS: '7200',
      });

      expect(env).toMatchObject({ STAFF_JWT_TTL_SECONDS: 3600, STAFF_REFRESH_TOKEN_TTL_SECONDS: 7200 });
    });
  });
});

describe('validateEnv TRUST_PROXY_HOPS', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when it is not set', () => {
    it('defaults to 0', () => {
      expect(validateEnv(validEnv).TRUST_PROXY_HOPS).toBe(0);
    });
  });

  describe('when it is a string integer from 0 to 10', () => {
    it.each(['0', '1', '10'])('accepts %s as a number', (value) => {
      expect(validateEnv({ ...validEnv, TRUST_PROXY_HOPS: value }).TRUST_PROXY_HOPS).toBe(
        Number(value),
      );
    });
  });

  describe('when it is out of range or not an integer', () => {
    it.each(['-1', '11', '1.5', 'abc', 'true'])('rejects %s', (value) => {
      expect(() => validateEnv({ ...validEnv, TRUST_PROXY_HOPS: value })).toThrow('env_invalid');
    });
  });
});
