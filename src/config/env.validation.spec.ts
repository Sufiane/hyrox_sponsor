import { Logger } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { validateEnv } from './env.validation';

const secret = 's'.repeat(32);
const databaseUrl = 'postgresql://user:pass@localhost:5435/db';
const validEnv = { JWT_SECRET: secret, DATABASE_URL: databaseUrl };

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
      expect(() => validateEnv({ DATABASE_URL: databaseUrl })).toThrow('env_invalid');
    });
  });

  describe('when DATABASE_URL is missing or not a postgres URL', () => {
    it.each([undefined, '', 'mysql://localhost/db', 'localhost:5435'])('throws env_invalid for %j', (url) => {
      expect(() => validateEnv({ JWT_SECRET: secret, DATABASE_URL: url })).toThrow('env_invalid');
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
});
