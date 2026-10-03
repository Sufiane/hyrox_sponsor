import { Transform } from 'class-transformer';
import { IsDate, IsIn, IsString, Length } from 'class-validator';
import { ianaTimezone, type IanaTimezone } from '../../common/iana-timezone';
import { DIVISION, type RaceDivisionCode } from '../race-division';
import { IsRaceDateInRange, parseRaceInstant } from './race-date';

const TEXT_MAX_LENGTH = 120;

function collapseWhitespace({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

export class LogRaceDto {
  @Transform(collapseWhitespace)
  @IsString()
  @Length(1, TEXT_MAX_LENGTH)
  name!: string;

  @Transform(({ value }: { value: unknown }) => parseRaceInstant(value))
  @IsDate()
  @IsRaceDateInRange()
  date!: Date;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? ianaTimezone(value) : value))
  @IsString()
  timezone!: IanaTimezone;

  @Transform(collapseWhitespace)
  @IsString()
  @Length(1, TEXT_MAX_LENGTH)
  location!: string;

  @IsIn(Object.values(DIVISION))
  division!: RaceDivisionCode;
}
