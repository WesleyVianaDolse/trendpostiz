import { Global, Module } from '@nestjs/common';
import { UploadFactory } from './upload.factory';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { ResumableUploadService } from '@gitroom/nestjs-libraries/upload/resumable.upload.service';

@Global()
@Module({
  providers: [UploadFactory, CustomFileValidationPipe, ResumableUploadService],
  exports: [UploadFactory, CustomFileValidationPipe, ResumableUploadService],
})
export class UploadModule {}
