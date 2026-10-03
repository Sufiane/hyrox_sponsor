import { Injectable } from '@nestjs/common';
import type { RefreshToken } from '@prisma/client';
import type { AthleteId } from '../common/ids';
import type { RefreshTokenHash } from '../common/refresh-token-hash';
import { PrismaService } from '../prisma/prisma.service';

export type RefreshTokenRecord = RefreshToken & { athleteId: AthleteId };

@Injectable()
export class RefreshTokenDb {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { athleteId: AthleteId; tokenHash: RefreshTokenHash; expiresAt: Date }): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({ data });
  }

  async findByHash(tokenHash: RefreshTokenHash): Promise<RefreshTokenRecord | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    return row as RefreshTokenRecord | null;
  }

  async revokeIfActive(id: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return result.count === 1;
  }

  async revokeAllForAthlete(athleteId: AthleteId): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { athleteId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeByHash(tokenHash: RefreshTokenHash): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
