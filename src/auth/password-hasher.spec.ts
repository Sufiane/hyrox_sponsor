import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  let hasher: PasswordHasher;

  beforeEach(async () => {
    hasher = new PasswordHasher();
    await hasher.onModuleInit();
  });

  describe('hash', () => {
    it('returns an argon2id hash', async () => {
      expect(await hasher.hash('correct horse battery')).toMatch(/^\$argon2id\$/);
    });
  });

  describe('verify', () => {
    describe('when the password matches', () => {
      it('returns true', async () => {
        const hash = await hasher.hash('correct horse battery');

        expect(await hasher.verify(hash, 'correct horse battery')).toBe(true);
      });
    });

    describe('when the password differs', () => {
      it('returns false', async () => {
        const hash = await hasher.hash('correct horse battery');

        expect(await hasher.verify(hash, 'wrong password')).toBe(false);
      });
    });
  });

  describe('verifyDummy', () => {
    it('resolves without a value', async () => {
      await expect(hasher.verifyDummy('anything')).resolves.toBeUndefined();
    });
  });
});
