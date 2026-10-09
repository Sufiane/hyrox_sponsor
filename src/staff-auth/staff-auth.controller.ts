import { Body, Controller, Get, HttpCode, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RefreshDto } from '../auth/dto/refresh.dto';
import type { StaffId } from '../common/ids';
import { CurrentStaffId } from './current-staff-id.decorator';
import { StaffLoginDto } from './dto/staff-login.dto';
import { toPublicStaff, type PublicStaff } from './public-staff';
import { StaffAuthService, type StaffAuthTokens, type StaffLoginResult } from './staff-auth.service';
import { StaffGuard } from './staff.guard';
import { StaffService } from './staff.service';

const LOGIN_LIMIT = { default: { limit: 5, ttl: 60_000 } };
const REFRESH_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('staff/auth')
export class StaffAuthController {
  constructor(
    private readonly authService: StaffAuthService,
    private readonly staffService: StaffService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle(LOGIN_LIMIT)
  login(@Body() dto: StaffLoginDto): Promise<StaffLoginResult> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle(REFRESH_LIMIT)
  refresh(@Body() dto: RefreshDto): Promise<StaffAuthTokens> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Body() dto: RefreshDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(StaffGuard)
  async me(@CurrentStaffId() staffId: StaffId): Promise<PublicStaff> {
    const staff = await this.staffService.findActiveById(staffId);

    if (!staff) {
      throw new UnauthorizedException('invalid_token');
    }

    return toPublicStaff(staff);
  }
}
