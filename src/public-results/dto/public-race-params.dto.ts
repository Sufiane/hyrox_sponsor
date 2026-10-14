import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';
import { raceId, type RaceId } from '../../common/ids';

export class PublicRaceParamsDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? raceId(value) : value))
  @IsString()
  raceId!: RaceId;
}
