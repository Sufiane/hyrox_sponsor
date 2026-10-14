import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { InvalidValueError } from '../../common/domain-error';
import { seconds, type Seconds } from '../../common/seconds';
import { PROOF_URL_MAX_LENGTH } from '../proof-url-policy';

const WHOLE_NUMBER = /^\d{1,6}$/;

function toSeconds(value: unknown): unknown {
  if (typeof value === 'number') {
    return seconds(value);
  }

  if (typeof value !== 'string') {
    return value;
  }

  if (!WHOLE_NUMBER.test(value.trim())) {
    throw new InvalidValueError('seconds_invalid');
  }

  return seconds(Number(value.trim()));
}

export class SubmitRaceResultDto {
  @Transform(({ value }: { value: unknown }) => toSeconds(value))
  @IsInt()
  finishTimeSeconds!: Seconds;

  @IsOptional()
  @IsString()
  @MaxLength(PROOF_URL_MAX_LENGTH)
  proofUrl?: string;
}
