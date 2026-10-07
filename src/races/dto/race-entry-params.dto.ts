import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';
import { raceEntryId, type RaceEntryId } from '../../common/ids';

export class RaceEntryParamsDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? raceEntryId(value) : value))
  @IsString()
  raceEntryId!: RaceEntryId;
}
