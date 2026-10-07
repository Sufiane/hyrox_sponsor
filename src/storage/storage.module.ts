import { Module } from '@nestjs/common';
import { DocumentStorage } from './document-storage';
import { S3DocumentStorage } from './s3-document-storage';

@Module({
  providers: [{ provide: DocumentStorage, useClass: S3DocumentStorage }],
  exports: [DocumentStorage],
})
export class StorageModule {}
