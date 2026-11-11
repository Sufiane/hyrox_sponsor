import { Controller, Get, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentAthleteId } from '../auth/current-athlete-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AthleteId } from '../common/ids';
import { ConnectService } from './connect.service';
import type { ConnectStatusResponse } from './dto/connect-status-response';
import type { OnboardingLinkResponse } from './dto/onboarding-link-response';

const ONBOARDING_LINK_LIMIT = { default: { limit: 5, ttl: 60_000 } };

@Controller('athletes/me/connect')
@UseGuards(JwtAuthGuard)
export class ConnectController {
  constructor(private readonly service: ConnectService) {}

  @Post('onboarding-link')
  @Throttle(ONBOARDING_LINK_LIMIT)
  async createOnboardingLink(
    @CurrentAthleteId() currentAthleteId: AthleteId | undefined,
  ): Promise<OnboardingLinkResponse> {
    const link = await this.service.createOnboardingLink(this.requireAthleteId(currentAthleteId));

    return { url: link.url, expiresAt: link.expiresAt };
  }

  @Get('status')
  async getStatus(@CurrentAthleteId() currentAthleteId: AthleteId | undefined): Promise<ConnectStatusResponse> {
    return this.service.getStatus(this.requireAthleteId(currentAthleteId));
  }

  private requireAthleteId(athleteId: AthleteId | undefined): AthleteId {
    if (athleteId == null) {
      throw new UnauthorizedException('invalid_token');
    }

    return athleteId;
  }
}
