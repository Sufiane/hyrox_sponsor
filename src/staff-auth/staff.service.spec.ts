import { Logger } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { StaffDb, type StaffRow } from './staff.db';
import { StaffService } from './staff.service';
import { ConflictError, NotFoundError } from '../common/domain-error';
import type { NormalizedEmail } from '../common/email';
import type { StaffId } from '../common/ids';
import type { PasswordHash } from '../common/password-hash';

describe('StaffService', () => {
  const id = 'staff-1' as StaffId;
  const email = 'jane@example.com' as NormalizedEmail;
  const hash = '$argon2id$hash' as PasswordHash;
  const activeRow = { id, email, passwordHash: hash, isActive: true } as StaffRow;
  let db: DeepMockProxy<StaffDb>;
  let service: StaffService;
  let warn: MockInstance;

  beforeEach(() => {
    db = mockDeep<StaffDb>();
    service = new StaffService(db);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('findActiveById', () => {
    describe('when the staff is active', () => {
      it('returns the row', async () => {
        db.findById.mockResolvedValue(activeRow);

        expect(await service.findActiveById(id)).toBe(activeRow);
      });
    });

    describe('when the staff is inactive', () => {
      it('returns null', async () => {
        db.findById.mockResolvedValue({ ...activeRow, isActive: false });

        expect(await service.findActiveById(id)).toBeNull();
      });
    });

    describe('when the staff is missing', () => {
      it('returns null', async () => {
        db.findById.mockResolvedValue(null);

        expect(await service.findActiveById(id)).toBeNull();
      });
    });
  });

  describe('findByEmail', () => {
    it('delegates to the db', async () => {
      db.findByEmail.mockResolvedValue(activeRow);

      expect(await service.findByEmail(email)).toBe(activeRow);
    });
  });

  describe('create', () => {
    const input = { name: 'Jane', email, passwordHash: hash };

    describe('when the email is free', () => {
      it('returns the created row', async () => {
        db.create.mockResolvedValue(activeRow);

        expect(await service.create(input)).toBe(activeRow);
      });
    });

    describe('when the email is already taken', () => {
      beforeEach(() => {
        db.create.mockResolvedValue(null);
      });

      it('throws staff_email_taken', async () => {
        await expect(service.create(input)).rejects.toThrow(ConflictError);
        await expect(service.create(input)).rejects.toThrow('staff_email_taken');
      });

      it('logs the detail', async () => {
        await service.create(input).catch(() => undefined);

        expect(warn).toHaveBeenCalled();
      });
    });
  });

  describe('setPassword', () => {
    describe('when the staff exists', () => {
      it('updates the password with a timestamp', async () => {
        db.findByEmail.mockResolvedValue(activeRow);
        db.updatePassword.mockResolvedValue(activeRow);

        await service.setPassword(email, hash);

        expect(db.updatePassword).toHaveBeenCalledWith(id, hash, expect.any(Date));
      });
    });

    describe('when no staff has that email', () => {
      beforeEach(() => {
        db.findByEmail.mockResolvedValue(null);
      });

      it('throws staff_not_found', async () => {
        await expect(service.setPassword(email, hash)).rejects.toThrow(NotFoundError);
        await expect(service.setPassword(email, hash)).rejects.toThrow('staff_not_found');
      });

      it('logs the detail', async () => {
        await service.setPassword(email, hash).catch(() => undefined);

        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the db returns null mid-operation', () => {
      it('throws staff_not_found', async () => {
        db.findByEmail.mockResolvedValue(activeRow);
        db.updatePassword.mockResolvedValue(null);

        await expect(service.setPassword(email, hash)).rejects.toThrow('staff_not_found');
      });
    });
  });

  describe('deactivate', () => {
    describe('when the staff exists', () => {
      it('deactivates with a timestamp', async () => {
        db.findByEmail.mockResolvedValue(activeRow);
        db.deactivate.mockResolvedValue(activeRow);

        await service.deactivate(email);

        expect(db.deactivate).toHaveBeenCalledWith(id, expect.any(Date));
      });
    });

    describe('when no staff has that email', () => {
      it('throws staff_not_found', async () => {
        db.findByEmail.mockResolvedValue(null);

        await expect(service.deactivate(email)).rejects.toThrow('staff_not_found');
        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the db returns null mid-operation', () => {
      it('throws staff_not_found', async () => {
        db.findByEmail.mockResolvedValue(activeRow);
        db.deactivate.mockResolvedValue(null);

        await expect(service.deactivate(email)).rejects.toThrow('staff_not_found');
      });
    });
  });
});
