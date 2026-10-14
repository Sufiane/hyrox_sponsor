import { Transform } from 'class-transformer';
import { IsDate, IsString, Length } from 'class-validator';

const REASON_MAX_LENGTH = 500;

function toDate(value: unknown): unknown {
  return typeof value === 'string' ? new Date(value) : value;
}

export class ApproveRaceResultDto {
  @Transform(({ value }: { value: unknown }) => toDate(value))
  @IsDate()
  submittedAt!: Date;
}

export class RejectRaceResultDto {
  @Transform(({ value }: { value: unknown }) => toDate(value))
  @IsDate()
  submittedAt!: Date;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, REASON_MAX_LENGTH)
  reason!: string;
}
