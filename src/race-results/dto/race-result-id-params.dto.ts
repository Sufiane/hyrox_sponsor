import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';
import { raceResultId, type RaceResultId } from '../../common/ids';

export class RaceResultIdParamsDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? raceResultId(value) : value))
  @IsString()
  raceResultId!: RaceResultId;
}
