import { errorCode } from './error-code.ts';

describe('errorCode', () => {
  describe('when the body message is a string', () => {
    it('returns the message', async () => {
      const response = new Response(JSON.stringify({ message: 'invalid_credentials' }), {
        status: 401,
      });

      await expect(errorCode(response)).resolves.toBe('invalid_credentials');
    });
  });

  describe('when the body is not json', () => {
    it('returns request_failed', async () => {
      await expect(errorCode(new Response('oops', { status: 500 }))).resolves.toBe(
        'request_failed',
      );
    });
  });

  describe('when the message is not a string', () => {
    it('returns request_failed', async () => {
      const response = new Response(JSON.stringify({ message: ['a', 'b'] }), { status: 400 });

      await expect(errorCode(response)).resolves.toBe('request_failed');
    });
  });
});
