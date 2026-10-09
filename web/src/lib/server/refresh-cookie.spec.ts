import { clearRefreshToken, readRefreshToken, writeRefreshToken } from './refresh-cookie.ts';
import { createFakeJar } from './fake-jar.ts';

describe('refresh cookie', () => {
  describe('writeRefreshToken', () => {
    describe('when secure is true', () => {
      it('sets an httpOnly strict cookie scoped to /session', () => {
        const jar = createFakeJar();

        writeRefreshToken(jar, 'tok', { secure: true, maxAgeSeconds: 2_592_000 });

        expect(jar.sets).toEqual([
          {
            name: 'hyrox_refresh',
            value: 'tok',
            options: {
              path: '/session',
              httpOnly: true,
              sameSite: 'strict',
              secure: true,
              maxAge: 2_592_000,
            },
          },
        ]);
      });
    });

    describe('when secure is false', () => {
      it('passes secure false through', () => {
        const jar = createFakeJar();

        writeRefreshToken(jar, 'tok', { secure: false, maxAgeSeconds: 60 });

        expect(jar.sets[0].options).toMatchObject({ secure: false, maxAge: 60 });
      });
    });
  });

  describe('readRefreshToken', () => {
    describe('when the cookie is set', () => {
      it('returns the token', () => {
        expect(readRefreshToken(createFakeJar('tok'))).toBe('tok');
      });
    });

    describe('when the cookie is missing', () => {
      it('returns null', () => {
        expect(readRefreshToken(createFakeJar(undefined))).toBeNull();
      });
    });

    describe('when the cookie is empty', () => {
      it('returns null', () => {
        expect(readRefreshToken(createFakeJar(''))).toBeNull();
      });
    });
  });

  describe('clearRefreshToken', () => {
    it('deletes the cookie on its path', () => {
      const jar = createFakeJar('tok');

      clearRefreshToken(jar);

      expect(jar.deletes).toEqual([{ name: 'hyrox_refresh', options: { path: '/session' } }]);
    });
  });
});
