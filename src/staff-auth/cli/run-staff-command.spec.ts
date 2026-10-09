import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PasswordHasher } from '../../auth/password-hasher';
import { ConflictError, NotFoundError } from '../../common/domain-error';
import type { PasswordHash } from '../../common/password-hash';
import type { StaffRow } from '../staff.db';
import { StaffService } from '../staff.service';
import { runStaffCommand } from './run-staff-command';

const GENERATED = 'generated-password-0123456789';
const SUPPLIED = 'supplied-password-1';
const hash = '$argon2id$hash' as PasswordHash;

describe('runStaffCommand', () => {
  let staffService: DeepMockProxy<StaffService>;
  let hasher: DeepMockProxy<PasswordHasher>;
  let generatePassword: ReturnType<typeof vi.fn<() => string>>;
  let write: ReturnType<typeof vi.fn<(line: string) => void>>;

  function run(argv: string[]): Promise<number> {
    return runStaffCommand(argv, { staffService, hasher, generatePassword, write });
  }

  function written(): string {
    return write.mock.calls.map(([line]) => line).join('\n');
  }

  beforeEach(() => {
    staffService = mockDeep<StaffService>();
    hasher = mockDeep<PasswordHasher>();
    generatePassword = vi.fn<() => string>().mockReturnValue(GENERATED);
    write = vi.fn<(line: string) => void>();
    hasher.hash.mockResolvedValue(hash);
    staffService.create.mockResolvedValue({ id: 'staff-1' } as StaffRow);
  });

  describe('create', () => {
    describe('when --password is absent', () => {
      it('generates a password, hashes it and creates the staff', async () => {
        const code = await run(['create', '--email', ' Jane@Example.com ', '--name', 'Jane Doe']);

        expect(code).toBe(0);
        expect(hasher.hash).toHaveBeenCalledWith(GENERATED);
        expect(staffService.create).toHaveBeenCalledWith({ name: 'Jane Doe', email: 'jane@example.com', passwordHash: hash });
      });

      it('writes the password exactly once', async () => {
        await run(['create', '--email', 'jane@example.com', '--name', 'Jane Doe']);

        const occurrences = write.mock.calls.filter(([line]) => line.includes(GENERATED));

        expect(occurrences).toHaveLength(1);
      });
    });

    describe('when --password is supplied', () => {
      it('hashes the supplied value without generating one', async () => {
        const code = await run(['create', '--email', 'jane@example.com', '--name', 'Jane', '--password', SUPPLIED]);

        expect(code).toBe(0);
        expect(generatePassword).not.toHaveBeenCalled();
        expect(hasher.hash).toHaveBeenCalledWith(SUPPLIED);
      });

      it('does not write the password back', async () => {
        await run(['create', '--email', 'jane@example.com', '--name', 'Jane', '--password', SUPPLIED]);

        expect(written()).not.toContain(SUPPLIED);
      });
    });

    describe.each([9, 129])('when the supplied password has %i characters', (length) => {
      it('returns 1 with password_length_invalid and calls no service', async () => {
        const code = await run([
          'create',
          '--email',
          'jane@example.com',
          '--name',
          'Jane',
          '--password',
          'p'.repeat(length),
        ]);

        expect(code).toBe(1);
        expect(written()).toContain('password_length_invalid');
        expect(staffService.create).not.toHaveBeenCalled();
        expect(hasher.hash).not.toHaveBeenCalled();
      });
    });

    describe('when the email is taken', () => {
      it('returns 1 with staff_email_taken', async () => {
        staffService.create.mockRejectedValue(new ConflictError('staff_email_taken'));

        expect(await run(['create', '--email', 'jane@example.com', '--name', 'Jane'])).toBe(1);
        expect(written()).toContain('staff_email_taken');
      });
    });

    describe.each(['', '   '])('when --name is %j', (name) => {
      it('returns 1 with args_invalid and creates nothing', async () => {
        expect(await run(['create', '--email', 'jane@example.com', '--name', name])).toBe(1);
        expect(written()).toContain('args_invalid');
        expect(staffService.create).not.toHaveBeenCalled();
      });
    });

    describe('when --name is padded', () => {
      it('creates the staff with the trimmed name', async () => {
        await run(['create', '--email', 'jane@example.com', '--name', '  Jane Doe ']);

        expect(staffService.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jane Doe' }));
      });
    });

    describe('when the email is malformed', () => {
      it('returns 1 with email_invalid and creates nothing', async () => {
        expect(await run(['create', '--email', 'not-an-email', '--name', 'Jane'])).toBe(1);
        expect(written()).toContain('email_invalid');
        expect(staffService.create).not.toHaveBeenCalled();
      });
    });

    describe('when --name is missing', () => {
      it('returns 1 with args_invalid', async () => {
        expect(await run(['create', '--email', 'jane@example.com'])).toBe(1);
        expect(written()).toContain('args_invalid');
      });
    });
  });

  describe('set-password', () => {
    describe('when --password is absent', () => {
      it('generates a password, prints it once and calls setPassword', async () => {
        const code = await run(['set-password', '--email', 'jane@example.com']);

        expect(code).toBe(0);
        expect(staffService.setPassword).toHaveBeenCalledWith('jane@example.com', hash);
        expect(write.mock.calls.filter(([line]) => line.includes(GENERATED))).toHaveLength(1);
      });
    });

    describe('when --password is supplied', () => {
      it('hashes it, calls setPassword and does not echo it', async () => {
        const code = await run(['set-password', '--email', 'jane@example.com', '--password', SUPPLIED]);

        expect(code).toBe(0);
        expect(generatePassword).not.toHaveBeenCalled();
        expect(hasher.hash).toHaveBeenCalledWith(SUPPLIED);
        expect(written()).not.toContain(SUPPLIED);
      });
    });

    describe('when the supplied password is too short', () => {
      it('returns 1 with password_length_invalid', async () => {
        expect(await run(['set-password', '--email', 'jane@example.com', '--password', 'short'])).toBe(1);
        expect(written()).toContain('password_length_invalid');
        expect(staffService.setPassword).not.toHaveBeenCalled();
      });
    });

    describe('when the staff is unknown', () => {
      it('returns 1 with staff_not_found', async () => {
        staffService.setPassword.mockRejectedValue(new NotFoundError('staff_not_found'));

        expect(await run(['set-password', '--email', 'jane@example.com'])).toBe(1);
        expect(written()).toContain('staff_not_found');
      });
    });
  });

  describe('deactivate', () => {
    describe('when the staff exists', () => {
      it('deactivates, returns 0 and writes no password', async () => {
        const code = await run(['deactivate', '--email', 'jane@example.com']);

        expect(code).toBe(0);
        expect(staffService.deactivate).toHaveBeenCalledWith('jane@example.com');
        expect(generatePassword).not.toHaveBeenCalled();
      });
    });

    describe('when --password is passed', () => {
      it('returns 1 with args_invalid', async () => {
        expect(await run(['deactivate', '--email', 'jane@example.com', '--password', SUPPLIED])).toBe(1);
        expect(written()).toContain('args_invalid');
        expect(staffService.deactivate).not.toHaveBeenCalled();
      });
    });

    describe('when the staff is unknown', () => {
      it('returns 1 with staff_not_found', async () => {
        staffService.deactivate.mockRejectedValue(new NotFoundError('staff_not_found'));

        expect(await run(['deactivate', '--email', 'jane@example.com'])).toBe(1);
        expect(written()).toContain('staff_not_found');
      });
    });
  });

  describe('when --email is missing', () => {
    it('returns 1 with args_invalid', async () => {
      expect(await run(['deactivate'])).toBe(1);
      expect(written()).toContain('args_invalid');
    });
  });

  describe('when the command is unknown or absent', () => {
    it.each([['explode', '--email', 'jane@example.com'], []])('returns 1 with args_invalid for %j', async (...argv) => {
      expect(await run(argv)).toBe(1);
      expect(written()).toContain('args_invalid');
    });
  });

  describe('when an option is unknown', () => {
    it('returns 1 with args_invalid', async () => {
      expect(await run(['deactivate', '--email', 'jane@example.com', '--bogus'])).toBe(1);
      expect(written()).toContain('args_invalid');
    });
  });

  describe('when the email is malformed', () => {
    it('returns 1 with email_invalid', async () => {
      expect(await run(['deactivate', '--email', 'not-an-email'])).toBe(1);
      expect(written()).toContain('email_invalid');
    });
  });
});
