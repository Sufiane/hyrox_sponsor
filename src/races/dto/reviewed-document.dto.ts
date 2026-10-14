import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';
import { documentKey, type DocumentKey } from '../../common/document-key';

export class ReviewedDocumentDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? documentKey(value) : value))
  @IsString()
  reviewedDocumentKey!: DocumentKey;
}
