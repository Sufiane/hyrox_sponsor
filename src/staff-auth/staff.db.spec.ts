import { Prisma } from '@prisma/client';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { StaffDb } from './staff.db';
import type { NormalizedEmail } from '../common/email';
import type { StaffId } from '../common/ids';
import type { PasswordHash } from '../common/password-hash';
import type { PrismaService } from '../prisma/prisma.service';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('failure', { code, clientVersion: 'test' });
}

describe('StaffDb', () => {
  const id = 'staff-1' as StaffId;
  const email = 'jane@example.com' as NormalizedEmail;
  const hash = '$argon2id$hash' as PasswordHash;
  const at = new Date('2026-10-09T10:00:00Z');
  const row = { id, email, passwordHash: hash };
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<PrismaService>;
  let db: StaffDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<PrismaService>();
    prisma.$transaction.mockImplementation(((callback: (client: unknown) => unknown) => callback(tx)) as never);
    db = new StaffDb(prisma);
  });

  describe('findById', () => {
    it('queries by id', async () => {
      prisma.staffMember.findUnique.mockResolvedValue(row as never);

      expect(await db.findById(id)).toBe(row);
      expect(prisma.staffMember.findUnique).toHaveBeenCalledWith({ where: { id } });
    });
  });

  describe('findByEmail', () => {
    it('queries by email', async () => {
      prisma.staffMember.findUnique.mockResolvedValue(row as never);

      expect(await db.findByEmail(email)).toBe(row);
      expect(prisma.staffMember.findUnique).toHaveBeenCalledWith({ where: { email } });
    });
  });

  describe('create', () => {
    const data = { name: 'Jane', email, passwordHash: hash };

    describe('when the insert succeeds', () => {
      it('returns the row', async () => {
        prisma.staffMember.create.mockResolvedValue(row as never);

        expect(await db.create(data)).toBe(row);
        expect(prisma.staffMember.create).toHaveBeenCalledWith({ data });
      });
    });

    describe('when the email hits a unique violation', () => {
      it('returns null', async () => {
        prisma.staffMember.create.mockRejectedValue(prismaError('P2002'));

        expect(await db.create(data)).toBeNull();
      });
    });

    describe('when another error occurs', () => {
      it('rethrows it', async () => {
        const failure = new Error('boom');

        prisma.staffMember.create.mockRejectedValue(failure);

        await expect(db.create(data)).rejects.toBe(failure);
      });
    });
  });

  describe('updatePassword', () => {
    describe('when the staff row exists', () => {
      beforeEach(() => {
        tx.staffMember.update.mockResolvedValue(row as never);
      });

      it('sets the hash and tokensValidAfter in one transaction', async () => {
        await db.updatePassword(id, hash, at);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.staffMember.update).toHaveBeenCalledWith({
          where: { id },
          data: { passwordHash: hash, tokensValidAfter: at },
        });
      });

      it('revokes the active refresh tokens', async () => {
        await db.updatePassword(id, hash, at);

        expect(tx.staffRefreshToken.updateMany).toHaveBeenCalledWith({
          where: { staffId: id, revokedAt: null },
          data: { revokedAt: at },
        });
      });

      it('returns the row', async () => {
        expect(await db.updatePassword(id, hash, at)).toBe(row);
      });
    });

    describe('when the staff row does not exist', () => {
      beforeEach(() => {
        tx.staffMember.update.mockRejectedValue(prismaError('P2025'));
      });

      it('returns null', async () => {
        expect(await db.updatePassword(id, hash, at)).toBeNull();
      });
    });

    describe('when another error occurs', () => {
      it('rethrows it', async () => {
        const failure = new Error('boom');

        tx.staffMember.update.mockRejectedValue(failure);

        await expect(db.updatePassword(id, hash, at)).rejects.toBe(failure);
      });
    });
  });

  describe('deactivate', () => {
    describe('when the staff row exists', () => {
      beforeEach(() => {
        tx.staffMember.update.mockResolvedValue(row as never);
      });

      it('sets isActive false and tokensValidAfter in one transaction', async () => {
        await db.deactivate(id, at);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.staffMember.update).toHaveBeenCalledWith({
          where: { id },
          data: { isActive: false, tokensValidAfter: at },
        });
      });

      it('revokes the active refresh tokens', async () => {
        await db.deactivate(id, at);

        expect(tx.staffRefreshToken.updateMany).toHaveBeenCalledWith({
          where: { staffId: id, revokedAt: null },
          data: { revokedAt: at },
        });
      });
    });

    describe('when the staff row does not exist', () => {
      beforeEach(() => {
        tx.staffMember.update.mockRejectedValue(prismaError('P2025'));
      });

      it('returns null', async () => {
        expect(await db.deactivate(id, at)).toBeNull();
      });
    });
  });
});
