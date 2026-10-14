import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { ReviewedDocumentDto } from './reviewed-document.dto';

const REASON_MAX_LENGTH = 500;

export class RejectVerificationDto extends ReviewedDocumentDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, REASON_MAX_LENGTH)
  reason!: string;
}
