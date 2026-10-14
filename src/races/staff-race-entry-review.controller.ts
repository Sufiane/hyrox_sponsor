import { Body, Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { StaffId } from '../common/ids';
import { CurrentStaffId } from '../staff-auth/current-staff-id.decorator';
import { StaffGuard } from '../staff-auth/staff.guard';
import { ApproveVerificationDto } from './dto/approve-verification.dto';
import { RaceEntryParamsDto } from './dto/race-entry-params.dto';
import { RejectVerificationDto } from './dto/reject-verification.dto';
import { RaceEntryService, type AwaitingReviewItem, type DocumentAccess } from './race-entry.service';

@Controller('staff/race-entries')
@UseGuards(StaffGuard)
export class StaffRaceEntryReviewController {
  constructor(private readonly service: RaceEntryService) {}

  @Get('awaiting-review')
  listAwaitingReview(): Promise<AwaitingReviewItem[]> {
    return this.service.listAwaitingReview();
  }

  @Get(':raceEntryId/verification-document-url')
  @Header('Cache-Control', 'no-store')
  getDocumentUrl(@Param() params: RaceEntryParamsDto): Promise<DocumentAccess> {
    return this.service.getDocumentAccess(params.raceEntryId);
  }

  @Post(':raceEntryId/verification/approve')
  @HttpCode(204)
  approve(
    @CurrentStaffId() staffId: StaffId,
    @Param() params: RaceEntryParamsDto,
    @Body() body: ApproveVerificationDto,
  ): Promise<void> {
    return this.service.reviewVerification({
      raceEntryId: params.raceEntryId,
      decision: 'APPROVE',
      reviewerId: staffId,
      reviewedDocumentKey: body.reviewedDocumentKey,
      reason: null,
    });
  }

  @Post(':raceEntryId/verification/reject')
  @HttpCode(204)
  reject(
    @CurrentStaffId() staffId: StaffId,
    @Param() params: RaceEntryParamsDto,
    @Body() body: RejectVerificationDto,
  ): Promise<void> {
    return this.service.reviewVerification({
      raceEntryId: params.raceEntryId,
      decision: 'REJECT',
      reviewerId: staffId,
      reviewedDocumentKey: body.reviewedDocumentKey,
      reason: body.reason,
    });
  }
}
