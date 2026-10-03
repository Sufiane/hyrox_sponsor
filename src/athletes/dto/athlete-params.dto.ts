import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';
import { athleteId, type AthleteId } from '../../common/ids';

export class AthleteParamsDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? athleteId(value) : value))
  @IsString()
  athleteId!: AthleteId;
}
