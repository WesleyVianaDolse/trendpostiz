import { Global, Module } from '@nestjs/common';
import { UploadFactory } from './upload.factory';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { ResumableUploadService } from '@gitroom/nestjs-libraries/upload/resumable.upload.service';
import { OrganizationFilesService } from './organization-files.service';

@Global()
@Module({
  providers: [UploadFactory, CustomFileValidationPipe, ResumableUploadService, OrganizationFilesService],
  exports: [UploadFactory, CustomFileValidationPipe, ResumableUploadService, OrganizationFilesService],
})
export class UploadModule {}
