import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

const BIB_MAX_LENGTH = 20;

export class SubmitVerificationDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, BIB_MAX_LENGTH)
  bibNumber!: string;
}
