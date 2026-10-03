import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AthleteService } from '../athletes/athlete.service';
import { toPublicAthlete, type PublicAthlete } from '../athletes/public-athlete';
import { normalizeEmail } from '../common/email';
import type { AthleteId } from '../common/ids';
import { PasswordHasher } from './password-hasher';
import { RefreshTokenDb } from './refresh-token.db';
import { TokenService } from './token.service';

export type AuthTokens = { accessToken: string; refreshToken: string; expiresIn: number };
export type AuthResult = AuthTokens & { athlete: PublicAthlete };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly athleteService: AthleteService,
    private readonly refreshTokenDb: RefreshTokenDb,
    private readonly tokenService: TokenService,
    private readonly hasher: PasswordHasher,
  ) {}

  async signup(input: {
    name: string;
    email: string;
    password: string;
    adultAttested?: boolean;
  }): Promise<AuthResult> {
    this.athleteService.assertAdultAttested(input.adultAttested);

    const passwordHash = await this.hasher.hash(input.password);
    const athlete = await this.athleteService.register({
      name: input.name,
      email: normalizeEmail(input.email),
      passwordHash,
      adultAttested: input.adultAttested,
    });
    const tokens = await this.issueTokens(athlete.id);

    return { ...tokens, athlete: toPublicAthlete(athlete) };
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    const athlete = await this.athleteService.findByEmail(email);

    if (!athlete) {
      await this.hasher.verifyDummy(input.password);
      this.logger.warn('Login failed: unknown email');

      throw new UnauthorizedException('invalid_credentials');
    }

    const isPasswordVerified = await this.hasher.verify(athlete.passwordHash, input.password);

    if (!isPasswordVerified) {
      this.logger.warn(`Login failed: wrong password for athlete ${athlete.id}`);

      throw new UnauthorizedException('invalid_credentials');
    }

    if (athlete.isBanned) {
      this.logger.warn(`Login refused: athlete ${athlete.id} is banned`);

      throw new ForbiddenException('athlete_banned');
    }

    const tokens = await this.issueTokens(athlete.id);

    return { ...tokens, athlete: toPublicAthlete(athlete) };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const row = await this.refreshTokenDb.findByHash(this.tokenService.hashRefreshToken(refreshToken));

    if (!row) {
      this.logger.warn('Refresh rejected: unknown token');

      throw new UnauthorizedException('invalid_refresh_token');
    }

    if (row.revokedAt != null) {
      return this.rejectReuse(row.athleteId, row.id);
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      this.logger.warn(`Refresh rejected: token ${row.id} expired`);

      throw new UnauthorizedException('invalid_refresh_token');
    }

    // Atomic revoke: of two concurrent refreshes with the same token, only one wins; the loser is treated as reuse.
    const revoked = await this.refreshTokenDb.revokeIfActive(row.id);

    if (!revoked) {
      return this.rejectReuse(row.athleteId, row.id);
    }

    const athlete = await this.athleteService.getById(row.athleteId);

    if (athlete.isBanned) {
      this.logger.warn(`Refresh refused: athlete ${row.athleteId} is banned`);

      throw new ForbiddenException('athlete_banned');
    }

    return this.issueTokens(row.athleteId);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokenDb.revokeByHash(this.tokenService.hashRefreshToken(refreshToken));
  }

  private async rejectReuse(athleteId: AthleteId, tokenId: string): Promise<never> {
    this.logger.warn(`Refresh token ${tokenId} reuse detected, revoking all tokens of athlete ${athleteId}`);
    await this.refreshTokenDb.revokeAllForAthlete(athleteId);

    throw new UnauthorizedException('invalid_refresh_token');
  }

  private async issueTokens(athleteId: AthleteId): Promise<AuthTokens> {
    const accessToken = await this.tokenService.signAccessToken(athleteId);
    const refresh = this.tokenService.createRefreshToken();

    await this.refreshTokenDb.create({ athleteId, tokenHash: refresh.hash, expiresAt: refresh.expiresAt });

    return { accessToken, refreshToken: refresh.token, expiresIn: this.tokenService.accessTtlSeconds };
  }
}
