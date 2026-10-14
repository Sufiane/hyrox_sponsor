import { Body, Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { StaffId } from '../common/ids';
import { CurrentStaffId } from '../staff-auth/current-staff-id.decorator';
import { StaffGuard } from '../staff-auth/staff.guard';
import { RaceResultIdParamsDto } from './dto/race-result-id-params.dto';
import { ApproveRaceResultDto, RejectRaceResultDto } from './dto/review-race-result.dto';
import type { PendingResultRecord } from './race-result.db';
import { RaceResultService, type StaffResultDetail } from './race-result.service';

export type AwaitingReviewResponse = { items: PendingResultRecord[] };

@Controller('staff/race-results')
@UseGuards(StaffGuard)
export class StaffRaceResultReviewController {
  constructor(private readonly service: RaceResultService) {}

  @Get()
  async listAwaitingReview(): Promise<AwaitingReviewResponse> {
    const items = await this.service.listAwaitingReview();

    return { items };
  }

  @Get(':raceResultId')
  @Header('Cache-Control', 'no-store')
  getDetail(@Param() params: RaceResultIdParamsDto): Promise<StaffResultDetail> {
    return this.service.getStaffDetail(params.raceResultId);
  }

  @Post(':raceResultId/approve')
  @HttpCode(204)
  approve(
    @CurrentStaffId() reviewerId: StaffId,
    @Param() params: RaceResultIdParamsDto,
    @Body() body: ApproveRaceResultDto,
  ): Promise<void> {
    return this.service.review({
      raceResultId: params.raceResultId,
      decision: 'APPROVE',
      reviewerId,
      expectedSubmittedAt: body.submittedAt,
      reason: null,
    });
  }

  @Post(':raceResultId/reject')
  @HttpCode(204)
  reject(
    @CurrentStaffId() reviewerId: StaffId,
    @Param() params: RaceResultIdParamsDto,
    @Body() body: RejectRaceResultDto,
  ): Promise<void> {
    return this.service.review({
      raceResultId: params.raceResultId,
      decision: 'REJECT',
      reviewerId,
      expectedSubmittedAt: body.submittedAt,
      reason: body.reason,
    });
  }
}
