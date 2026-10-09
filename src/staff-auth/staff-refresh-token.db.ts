import { Injectable } from '@nestjs/common';
import type { StaffRefreshToken } from '@prisma/client';
import type { StaffId, StaffRefreshTokenId } from '../common/ids';
import type { RefreshTokenHash } from '../common/refresh-token-hash';
import { PrismaService } from '../prisma/prisma.service';

export type StaffRefreshTokenRecord = StaffRefreshToken & { id: StaffRefreshTokenId; staffId: StaffId };

@Injectable()
export class StaffRefreshTokenDb {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { staffId: StaffId; tokenHash: RefreshTokenHash; expiresAt: Date }): Promise<StaffRefreshToken> {
    return this.prisma.staffRefreshToken.create({ data });
  }

  async findByHash(tokenHash: RefreshTokenHash): Promise<StaffRefreshTokenRecord | null> {
    const row = await this.prisma.staffRefreshToken.findUnique({ where: { tokenHash } });

    return row as StaffRefreshTokenRecord | null;
  }

  async revokeIfActive(id: StaffRefreshTokenId): Promise<boolean> {
    const result = await this.prisma.staffRefreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return result.count === 1;
  }

  async revokeAllForStaff(staffId: StaffId): Promise<void> {
    await this.prisma.staffRefreshToken.updateMany({
      where: { staffId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeByHash(tokenHash: RefreshTokenHash): Promise<void> {
    await this.prisma.staffRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
