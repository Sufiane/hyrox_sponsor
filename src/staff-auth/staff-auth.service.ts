import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PasswordHasher } from '../auth/password-hasher';
import { normalizeEmail } from '../common/email';
import type { StaffId, StaffRefreshTokenId } from '../common/ids';
import { toPublicStaff, type PublicStaff } from './public-staff';
import type { StaffRow } from './staff.db';
import { StaffRefreshTokenDb } from './staff-refresh-token.db';
import { StaffTokenService } from './staff-token.service';
import { StaffService } from './staff.service';

export type StaffAuthTokens = { accessToken: string; refreshToken: string; expiresIn: number };
export type StaffLoginResult = StaffAuthTokens & { staff: PublicStaff };

@Injectable()
export class StaffAuthService {
  private readonly logger = new Logger(StaffAuthService.name);

  constructor(
    private readonly staffService: StaffService,
    private readonly refreshTokenDb: StaffRefreshTokenDb,
    private readonly tokenService: StaffTokenService,
    private readonly hasher: PasswordHasher,
  ) {}

  async login(input: { email: string; password: string }): Promise<StaffLoginResult> {
    const email = normalizeEmail(input.email);
    const staff = await this.staffService.findByEmail(email);

    if (!staff) {
      await this.hasher.verifyDummy(input.password);
      this.logger.warn('Staff login failed: unknown email');

      throw new UnauthorizedException('invalid_credentials');
    }

    const isPasswordVerified = await this.hasher.verify(staff.passwordHash, input.password);

    if (!isPasswordVerified) {
      this.logger.warn(`Staff login failed: wrong password for staff ${staff.id}`);

      throw new UnauthorizedException('invalid_credentials');
    }

    if (!staff.isActive) {
      this.logger.warn(`Staff login refused: staff ${staff.id} is inactive`);

      throw new UnauthorizedException('invalid_credentials');
    }

    const tokens = await this.issueTokens(staff.id);

    return { ...tokens, staff: toPublicStaff(staff) };
  }

  async refresh(refreshToken: string): Promise<StaffAuthTokens> {
    const row = await this.refreshTokenDb.findByHash(this.tokenService.hashRefreshToken(refreshToken));

    if (!row) {
      this.logger.warn('Staff refresh rejected: unknown token');

      throw new UnauthorizedException('invalid_refresh_token');
    }

    if (row.revokedAt != null) {
      return this.rejectReuse(row.staffId, row.id);
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      this.logger.warn(`Staff refresh rejected: token ${row.id} expired`);

      throw new UnauthorizedException('invalid_refresh_token');
    }

    const revoked = await this.refreshTokenDb.revokeIfActive(row.id);

    if (!revoked) {
      return this.rejectReuse(row.staffId, row.id);
    }

    const staff = await this.staffService.findActiveById(row.staffId);

    if (!staff) {
      this.logger.warn(`Staff refresh rejected: staff ${row.staffId} missing or inactive`);

      throw new UnauthorizedException('invalid_refresh_token');
    }

    const tokens = await this.issueTokens(staff.id);

    await this.assertUnchangedSince(staff);

    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokenDb.revokeByHash(this.tokenService.hashRefreshToken(refreshToken));
  }

  // A set-password/deactivate that commits while the new pair is being issued would otherwise leave a live session behind.
  private async assertUnchangedSince(before: StaffRow): Promise<void> {
    const after = await this.staffService.findActiveById(before.id);

    if (after && after.tokensValidAfter?.getTime() === before.tokensValidAfter?.getTime()) {
      return;
    }

    this.logger.warn(`Staff refresh rejected: staff ${before.id} changed while issuing tokens`);
    await this.refreshTokenDb.revokeAllForStaff(before.id);

    throw new UnauthorizedException('invalid_refresh_token');
  }

  private async rejectReuse(staffId: StaffId, tokenId: StaffRefreshTokenId): Promise<never> {
    this.logger.warn(`Staff refresh token ${tokenId} reuse detected, revoking all tokens of staff ${staffId}`);
    await this.refreshTokenDb.revokeAllForStaff(staffId);

    throw new UnauthorizedException('invalid_refresh_token');
  }

  private async issueTokens(staffId: StaffId): Promise<StaffAuthTokens> {
    const accessToken = await this.tokenService.signAccessToken(staffId);
    const refresh = this.tokenService.createRefreshToken();

    await this.refreshTokenDb.create({ staffId, tokenHash: refresh.hash, expiresAt: refresh.expiresAt });

    return { accessToken, refreshToken: refresh.token, expiresIn: this.tokenService.accessTtlSeconds };
  }
}
