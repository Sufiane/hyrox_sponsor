import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentAthleteId } from '../auth/current-athlete-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MAX_DOCUMENT_BYTES } from '../common/document-limits';
import type { AthleteId, RaceEntryId } from '../common/ids';
import { RaceEntryParamsDto } from '../races/dto/race-entry-params.dto';
import { SubmitRaceResultDto } from './dto/submit-race-result.dto';
import type { OwnEntryRecord } from './race-result.db';
import { RaceResultService, type OwnResultView } from './race-result.service';

const SUBMIT_LIMIT = { default: { limit: 10, ttl: 60_000 } };

export type SubmitRaceResultResponse = {
  raceEntryId: RaceEntryId;
  status: 'PENDING';
  submittedAt: Date;
  publicVisible: boolean;
};

export type OwnEntriesResponse = { items: OwnEntryRecord[] };

@Controller('race-entries')
@UseGuards(JwtAuthGuard)
export class RaceResultController {
  constructor(private readonly service: RaceResultService) {}

  @Get()
  async listOwnEntries(@CurrentAthleteId() currentAthleteId: AthleteId | undefined): Promise<OwnEntriesResponse> {
    const items = await this.service.listOwnEntries(this.requireAthleteId(currentAthleteId));

    return { items };
  }

  @Put(':raceEntryId/result')
  @Throttle(SUBMIT_LIMIT)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async submitResult(
    @CurrentAthleteId() currentAthleteId: AthleteId | undefined,
    @Param() params: RaceEntryParamsDto,
    @Body() body: SubmitRaceResultDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<SubmitRaceResultResponse> {
    const athleteId = this.requireAthleteId(currentAthleteId);
    const result = await this.service.submit({
      athleteId,
      raceEntryId: params.raceEntryId,
      finishTimeSeconds: body.finishTimeSeconds,
      proofUrl: body.proofUrl ?? null,
      photo: file?.buffer ?? null,
    });

    return {
      raceEntryId: params.raceEntryId,
      status: result.status,
      submittedAt: result.submittedAt,
      publicVisible: result.publicVisible,
    };
  }

  @Get(':raceEntryId/result')
  getOwnResult(
    @CurrentAthleteId() currentAthleteId: AthleteId | undefined,
    @Param() params: RaceEntryParamsDto,
  ): Promise<OwnResultView> {
    return this.service.getOwnResult(this.requireAthleteId(currentAthleteId), params.raceEntryId);
  }

  private requireAthleteId(athleteId: AthleteId | undefined): AthleteId {
    if (athleteId == null) {
      throw new UnauthorizedException('invalid_token');
    }

    return athleteId;
  }
}
