import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import ResultSubmitForm from './ResultSubmitForm.svelte';
import type { ApiResult } from './api-result.ts';
import type { ResultSubmitApi, SubmitResultInput } from './result-submit-api.ts';
import type { OwnResult, SubmitResultResponse } from './results-types.ts';

const OWN: OwnResult = {
  status: 'PENDING',
  finishTimeSeconds: 3_725,
  proofUrl: 'https://results.example/a',
  hasPhoto: true,
  rejectionReason: null,
  submittedAt: '2026-10-11T10:00:00.000Z',
  reviewedAt: null,
  publicVisible: true,
  bibVerificationStatus: 'VERIFIED',
};

const NOT_FOUND = { ok: false, status: 404, code: 'race_result_not_found' } as const;
const SUBMITTED: ApiResult<SubmitResultResponse> = {
  ok: true,
  value: { raceEntryId: 'e1', status: 'PENDING', submittedAt: '', publicVisible: true },
};

describe('ResultSubmitForm', () => {
  let getOwnResult: Mock<ResultSubmitApi['getOwnResult']>;
  let submitResult: Mock<ResultSubmitApi['submitResult']>;

  async function renderForm(): Promise<void> {
    const api: ResultSubmitApi = {
      getOwnResult,
      submitResult,
      listOwnEntries: vi.fn(),
    };

    render(ResultSubmitForm, { raceEntryId: 'e1', api });
    await screen.findByRole('button', { name: /result$/ });
  }

  function photoFile(type = 'image/jpeg', size = 100): File {
    const file = new File(['x'], 'clock.jpg', { type });

    Object.defineProperty(file, 'size', { value: size });

    return file;
  }

  async function fillTime(hours: string, minutes: string, seconds: string): Promise<void> {
    const user = userEvent.setup();

    for (const [label, value] of [
      ['Hours', hours],
      ['Minutes', minutes],
      ['Seconds', seconds],
    ]) {
      const input = screen.getByLabelText(label);

      await user.clear(input);
      await user.type(input, value);
    }
  }

  let revokeObjectURL: Mock<(url: string) => void>;

  beforeEach(() => {
    revokeObjectURL = vi.fn<(url: string) => void>();
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = revokeObjectURL;
    getOwnResult = vi.fn<ResultSubmitApi['getOwnResult']>().mockResolvedValue(NOT_FOUND);
    submitResult = vi.fn<ResultSubmitApi['submitResult']>().mockResolvedValue(SUBMITTED);
  });

  describe('when there is no result yet', () => {
    it('shows an empty form with no status banner', async () => {
      await renderForm();

      expect(screen.queryByLabelText('Current status')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Hours')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Submit result' })).toBeEnabled();
    });

    describe('and the time is out of range', () => {
      it('shows an error without calling the api', async () => {
        await renderForm();
        await fillTime('0', '10', '0');
        await userEvent.upload(screen.getByLabelText('Photo of the finish clock'), photoFile());
        await userEvent.click(screen.getByRole('button', { name: 'Submit result' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/between 0:30:00 and 6:00:00/);
        expect(submitResult).not.toHaveBeenCalled();
      });
    });

    describe('and no photo is chosen', () => {
      it('asks for a photo', async () => {
        await renderForm();
        await fillTime('1', '2', '5');
        await userEvent.click(screen.getByRole('button', { name: 'Submit result' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
          'Add a photo of the finish clock.',
        );
        expect(submitResult).not.toHaveBeenCalled();
      });
    });

    describe('and the photo type is unsupported', () => {
      it('shows an error', async () => {
        await renderForm();
        await userEvent.upload(
          screen.getByLabelText('Photo of the finish clock'),
          photoFile('application/pdf'),
          { applyAccept: false },
        );

        expect(await screen.findByRole('alert')).toHaveTextContent(/JPEG, PNG or WebP/);
      });
    });

    describe('and the photo is over 10 MiB', () => {
      it('shows an error', async () => {
        await renderForm();
        await userEvent.upload(
          screen.getByLabelText('Photo of the finish clock'),
          photoFile('image/png', 10_485_761),
        );

        expect(await screen.findByRole('alert')).toHaveTextContent(/10 MB/);
      });
    });

    describe('and a valid photo is chosen', () => {
      it('previews it and revokes the object URL on unmount', async () => {
        const { unmount } = render(ResultSubmitForm, {
          raceEntryId: 'e1',
          api: { getOwnResult, submitResult, listOwnEntries: vi.fn() },
        });

        await screen.findByRole('button', { name: 'Submit result' });
        await userEvent.upload(screen.getByLabelText('Photo of the finish clock'), photoFile());

        expect(await screen.findByAltText('Selected finish clock')).toHaveAttribute(
          'src',
          'blob:preview',
        );

        unmount();

        expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
      });
    });

    describe('and the chosen photo is rejected', () => {
      it('clears the file input', async () => {
        await renderForm();

        const input = screen.getByLabelText('Photo of the finish clock') as HTMLInputElement;

        await userEvent.upload(input, photoFile('application/pdf'), { applyAccept: false });

        expect(input.files).toHaveLength(0);
      });
    });

    describe('and the input is valid', () => {
      it('submits total seconds, link and photo', async () => {
        await renderForm();
        await fillTime('1', '2', '5');
        await userEvent.upload(screen.getByLabelText('Photo of the finish clock'), photoFile());
        await userEvent.type(
          screen.getByLabelText(/Link to the official result/),
          'https://results.example/b',
        );
        await userEvent.click(screen.getByRole('button', { name: 'Submit result' }));

        await waitFor(() => expect(submitResult).toHaveBeenCalledTimes(1));

        const input = submitResult.mock.calls[0][1] as SubmitResultInput;

        expect(submitResult.mock.calls[0][0]).toBe('e1');
        expect(input.finishTimeSeconds).toBe(3_725);
        expect(input.proofUrl).toBe('https://results.example/b');
        expect(input.photo?.name).toBe('clock.jpg');
        expect(
          await screen.findByText('Result submitted. Staff will review it.'),
        ).toBeInTheDocument();
      });
    });
  });

  describe('when the submission succeeds', () => {
    it('clears the file input', async () => {
      await renderForm();
      await fillTime('1', '2', '5');

      const input = screen.getByLabelText('Photo of the finish clock') as HTMLInputElement;

      await userEvent.upload(input, photoFile());
      await userEvent.click(screen.getByRole('button', { name: 'Submit result' }));
      await screen.findByText('Result submitted. Staff will review it.');

      expect(input.files).toHaveLength(0);
    });

    describe('and refreshing the status fails', () => {
      it('tells the user instead of keeping a stale status', async () => {
        await renderForm();
        await fillTime('1', '2', '5');
        getOwnResult.mockResolvedValue({ ok: false, status: 500, code: 'x' });
        await userEvent.upload(screen.getByLabelText('Photo of the finish clock'), photoFile());
        await userEvent.click(screen.getByRole('button', { name: 'Submit result' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not refresh its status/);
      });
    });
  });

  describe('when the session has expired during submit', () => {
    it('asks the user to sign in again', async () => {
      submitResult.mockResolvedValue({ ok: false, status: 401, code: 'not_authenticated' });
      await renderForm();
      await fillTime('1', '2', '5');
      await userEvent.upload(screen.getByLabelText('Photo of the finish clock'), photoFile());
      await userEvent.click(screen.getByRole('button', { name: 'Submit result' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again');
    });
  });

  describe('when the backend rejects the submission', () => {
    it.each([
      ['race_not_finished', /not finished yet/],
      ['proof_url_host_not_allowed', /not accepted/],
      ['proof_photo_type_unsupported', /JPEG, PNG or WebP/],
      ['athlete_banned', /suspended/],
    ])('maps %s to a message', async (code, pattern) => {
      submitResult.mockResolvedValue({ ok: false, status: 400, code });
      await renderForm();
      await fillTime('1', '2', '5');
      await userEvent.upload(screen.getByLabelText('Photo of the finish clock'), photoFile());
      await userEvent.click(screen.getByRole('button', { name: 'Submit result' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(pattern);
    });
  });

  describe('while submitting', () => {
    it('disables the button', async () => {
      let release: (value: ApiResult<SubmitResultResponse>) => void = () => undefined;

      submitResult.mockReturnValue(new Promise((resolve) => (release = resolve)));
      await renderForm();
      await fillTime('1', '2', '5');
      await userEvent.upload(screen.getByLabelText('Photo of the finish clock'), photoFile());
      await userEvent.click(screen.getByRole('button', { name: 'Submit result' }));

      expect(await screen.findByRole('button', { name: 'Submitting...' })).toBeDisabled();

      release(SUBMITTED);
    });
  });

  describe('when a result is pending', () => {
    beforeEach(() => {
      getOwnResult.mockResolvedValue({ ok: true, value: OWN });
    });

    it('prefills the form and offers to keep the photo', async () => {
      await renderForm();

      expect(screen.getByLabelText('Hours')).toHaveValue('1');
      expect(screen.getByLabelText('Minutes')).toHaveValue('2');
      expect(screen.getByLabelText('Seconds')).toHaveValue('5');
      expect(screen.getByLabelText(/Link to the official result/)).toHaveValue(
        'https://results.example/a',
      );
      expect(screen.getByText(/Awaiting review/)).toBeInTheDocument();
      expect(screen.getByText(/keep your current photo/)).toBeInTheDocument();
    });

    it('submits without a new photo', async () => {
      await renderForm();
      await userEvent.click(screen.getByRole('button', { name: 'Resubmit result' }));

      await waitFor(() => expect(submitResult).toHaveBeenCalledTimes(1));
      expect((submitResult.mock.calls[0][1] as SubmitResultInput).photo).toBeNull();
    });

    describe('and the bib is not verified yet', () => {
      it('explains the result is not public', async () => {
        getOwnResult.mockResolvedValue({
          ok: true,
          value: { ...OWN, publicVisible: false, bibVerificationStatus: 'PENDING' },
        });
        await renderForm();

        expect(screen.getByText(/appear publicly once your bib is verified/)).toBeInTheDocument();
      });
    });
  });

  describe('when the result is verified', () => {
    it('warns that editing sends it back to review', async () => {
      getOwnResult.mockResolvedValue({ ok: true, value: { ...OWN, status: 'VERIFIED' } });
      await renderForm();

      expect(screen.getByText(/sends this result back to review/)).toBeInTheDocument();
    });
  });

  describe('when the result was rejected', () => {
    it('shows the reason', async () => {
      getOwnResult.mockResolvedValue({
        ok: true,
        value: { ...OWN, status: 'REJECTED', rejectionReason: 'Clock not readable' },
      });
      await renderForm();

      expect(screen.getByText('Reason: Clock not readable')).toBeInTheDocument();
    });
  });

  describe('when loading the current result fails', () => {
    it('shows an error and no form', async () => {
      getOwnResult.mockResolvedValue({ ok: false, status: 500, code: 'x' });
      render(ResultSubmitForm, {
        raceEntryId: 'e1',
        api: { getOwnResult, submitResult, listOwnEntries: vi.fn() },
      });

      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
