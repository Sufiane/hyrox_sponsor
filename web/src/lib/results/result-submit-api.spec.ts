import type { Mock } from 'vitest';
import { NotAuthenticatedError } from '../auth/auth-types.ts';
import { createResultSubmitApi } from './result-submit-api.ts';

describe('createResultSubmitApi', () => {
  let authedFetch: Mock<typeof fetch>;

  function api(): ReturnType<typeof createResultSubmitApi> {
    return createResultSubmitApi('http://api.test', authedFetch);
  }

  beforeEach(() => {
    authedFetch = vi.fn<typeof fetch>();
  });

  describe('submitResult', () => {
    const photo = new File(['x'], 'clock.jpg', { type: 'image/jpeg' });

    it('puts multipart form data without a content type header', async () => {
      authedFetch.mockResolvedValue(new Response(JSON.stringify({ status: 'PENDING' })));

      await api().submitResult('e/1', {
        finishTimeSeconds: 3_725,
        proofUrl: ' https://results.example/a ',
        photo,
      });

      const [url, init] = authedFetch.mock.calls[0];
      const body = init?.body as FormData;

      expect(url).toBe('http://api.test/race-entries/e%2F1/result');
      expect(init?.method).toBe('PUT');
      expect(init?.headers).toBeUndefined();
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('finishTimeSeconds')).toBe('3725');
      expect(body.get('proofUrl')).toBe('https://results.example/a');
      expect((body.get('photo') as File).name).toBe('clock.jpg');
    });

    describe('when the link is blank and there is no photo', () => {
      it('omits both fields', async () => {
        authedFetch.mockResolvedValue(new Response(JSON.stringify({ status: 'PENDING' })));

        await api().submitResult('e1', { finishTimeSeconds: 3_000, proofUrl: '  ', photo: null });

        const body = authedFetch.mock.calls[0][1]?.body as FormData;

        expect(body.has('proofUrl')).toBe(false);
        expect(body.has('photo')).toBe(false);
      });
    });

    describe('when the backend rejects the submission', () => {
      it('returns the error code', async () => {
        authedFetch.mockResolvedValue(
          new Response(JSON.stringify({ message: 'race_not_finished' }), { status: 409 }),
        );

        expect(await api().submitResult('e1', { finishTimeSeconds: 3_000, photo })).toEqual({
          ok: false,
          status: 409,
          code: 'race_not_finished',
        });
      });
    });
  });

  describe('getOwnResult', () => {
    describe('when no result exists', () => {
      it('returns the 404 code', async () => {
        authedFetch.mockResolvedValue(
          new Response(JSON.stringify({ message: 'race_result_not_found' }), { status: 404 }),
        );

        expect(await api().getOwnResult('e1')).toMatchObject({
          ok: false,
          status: 404,
          code: 'race_result_not_found',
        });
      });
    });
  });

  describe('when the session has expired', () => {
    it('returns a 401 not_authenticated result', async () => {
      authedFetch.mockRejectedValue(new NotAuthenticatedError());

      expect(await api().getOwnResult('e1')).toEqual({
        ok: false,
        status: 401,
        code: 'not_authenticated',
      });
    });
  });

  describe('listOwnEntries', () => {
    it('returns the items', async () => {
      authedFetch.mockResolvedValue(new Response(JSON.stringify({ items: [] })));

      expect(await api().listOwnEntries()).toEqual({ ok: true, value: { items: [] } });
      expect(authedFetch.mock.calls[0][0]).toBe('http://api.test/race-entries');
    });
  });
});
