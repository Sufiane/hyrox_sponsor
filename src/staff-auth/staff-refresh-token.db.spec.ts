import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { StaffRefreshTokenDb } from './staff-refresh-token.db';
import type { StaffId, StaffRefreshTokenId } from '../common/ids';
import type { RefreshTokenHash } from '../common/refresh-token-hash';
import type { PrismaService } from '../prisma/prisma.service';

describe('StaffRefreshTokenDb', () => {
  const staffId = 'staff-1' as StaffId;
  const tokenHash = 'a'.repeat(64) as RefreshTokenHash;
  let prisma: DeepMockProxy<PrismaService>;
  let db: StaffRefreshTokenDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new StaffRefreshTokenDb(prisma);
  });

  describe('create', () => {
    it('passes the data through', async () => {
      const data = { staffId, tokenHash, expiresAt: new Date('2026-10-16T00:00:00Z') };

      prisma.staffRefreshToken.create.mockResolvedValue({ id: 'token-1' } as never);

      expect(await db.create(data)).toEqual({ id: 'token-1' });
      expect(prisma.staffRefreshToken.create).toHaveBeenCalledWith({ data });
    });
  });

  describe('findByHash', () => {
    describe('when the token exists', () => {
      it('returns the row', async () => {
        prisma.staffRefreshToken.findUnique.mockResolvedValue({ id: 'token-1' } as never);

        expect(await db.findByHash(tokenHash)).toEqual({ id: 'token-1' });
        expect(prisma.staffRefreshToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash } });
      });
    });

    describe('when the token is absent', () => {
      it('returns null', async () => {
        prisma.staffRefreshToken.findUnique.mockResolvedValue(null);

        expect(await db.findByHash(tokenHash)).toBeNull();
      });
    });
  });

  describe('revokeIfActive', () => {
    describe('when one row is updated', () => {
      it('returns true', async () => {
        prisma.staffRefreshToken.updateMany.mockResolvedValue({ count: 1 });

        expect(await db.revokeIfActive('token-1' as StaffRefreshTokenId)).toBe(true);
        expect(prisma.staffRefreshToken.updateMany).toHaveBeenCalledWith({
          where: { id: 'token-1', revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        });
      });
    });

    describe('when no row is updated', () => {
      it('returns false', async () => {
        prisma.staffRefreshToken.updateMany.mockResolvedValue({ count: 0 });

        expect(await db.revokeIfActive('token-1' as StaffRefreshTokenId)).toBe(false);
      });
    });
  });

  describe('revokeAllForStaff', () => {
    it('revokes only non-revoked rows of that staff member', async () => {
      await db.revokeAllForStaff(staffId);

      expect(prisma.staffRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { staffId, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('revokeByHash', () => {
    it('revokes only the non-revoked row with that hash', async () => {
      await db.revokeByHash(tokenHash);

      expect(prisma.staffRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
