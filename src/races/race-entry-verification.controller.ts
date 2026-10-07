import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentAthleteId } from '../auth/current-athlete-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MAX_DOCUMENT_BYTES } from '../common/document-limits';
import { InvalidValueError } from '../common/domain-error';
import type { AthleteId, RaceEntryId } from '../common/ids';
import { RaceEntryParamsDto } from './dto/race-entry-params.dto';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { RaceEntryService, type VerificationStatusView } from './race-entry.service';

export type SubmitVerificationResponse = {
  raceEntryId: RaceEntryId;
  verificationStatus: 'PENDING';
  submittedAt: Date;
};

@Controller('race-entries/:raceEntryId')
@UseGuards(JwtAuthGuard)
export class RaceEntryVerificationController {
  constructor(private readonly service: RaceEntryService) {}

  @Post('verification-document')
  @UseInterceptors(FileInterceptor('document', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async submitDocument(
    @CurrentAthleteId() currentAthleteId: AthleteId | undefined,
    @Param() params: RaceEntryParamsDto,
    @Body() body: SubmitVerificationDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<SubmitVerificationResponse> {
    const athleteId = this.requireAthleteId(currentAthleteId);

    if (!file) {
      throw new InvalidValueError('document_missing');
    }

    const result = await this.service.submitVerificationDocument({
      athleteId,
      raceEntryId: params.raceEntryId,
      bibNumber: body.bibNumber,
      file: file.buffer,
    });

    return {
      raceEntryId: params.raceEntryId,
      verificationStatus: result.verificationStatus,
      submittedAt: result.submittedAt,
    };
  }

  @Get('verification')
  async getStatus(
    @CurrentAthleteId() currentAthleteId: AthleteId | undefined,
    @Param() params: RaceEntryParamsDto,
  ): Promise<VerificationStatusView> {
    return this.service.getVerificationStatus(this.requireAthleteId(currentAthleteId), params.raceEntryId);
  }

  private requireAthleteId(athleteId: AthleteId | undefined): AthleteId {
    if (athleteId == null) {
      throw new UnauthorizedException('invalid_token');
    }

    return athleteId;
  }
}
