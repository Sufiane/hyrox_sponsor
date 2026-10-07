import { Module } from '@nestjs/common';
import { StorageModule } from '../../../storage/storage.module';
import { SubmitVerificationDocumentUsecase } from './submit-verification-document.usecase';
import { SubmitVerificationDocumentUsecaseDb } from './submit-verification-document.usecase.db';

@Module({
  imports: [StorageModule],
  providers: [SubmitVerificationDocumentUsecase, SubmitVerificationDocumentUsecaseDb],
  exports: [SubmitVerificationDocumentUsecase],
})
export class SubmitVerificationDocumentModule {}
