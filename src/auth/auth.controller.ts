import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AthleteService } from '../athletes/athlete.service';
import { toPublicAthlete, type PublicAthlete } from '../athletes/public-athlete';
import type { AthleteId } from '../common/ids';
import { AuthService, type AuthResult, type AuthTokens } from './auth.service';
import { CurrentAthleteId } from './current-athlete-id.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

const SENSITIVE_ROUTE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly athleteService: AthleteService,
  ) {}

  @Post('signup')
  @Throttle(SENSITIVE_ROUTE_LIMIT)
  signup(@Body() dto: SignupDto): Promise<AuthResult> {
    return this.authService.signup(dto);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(SENSITIVE_ROUTE_LIMIT)
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle(SENSITIVE_ROUTE_LIMIT)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Body() dto: RefreshDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentAthleteId() athleteId: AthleteId): Promise<PublicAthlete> {
    return toPublicAthlete(await this.athleteService.getById(athleteId));
  }
}
