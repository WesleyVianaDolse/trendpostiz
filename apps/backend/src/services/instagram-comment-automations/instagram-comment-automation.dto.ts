import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { InstagramCommentMatchType } from '@prisma/client';

export class CreateInstagramCommentAutomationDto {
  @IsString()
  integrationId!: string;

  @IsString()
  mediaId!: string;

  @IsEnum(InstagramCommentMatchType)
  matchType!: InstagramCommentMatchType;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  triggers!: string[];

  @IsBoolean()
  publicReplyEnabled!: boolean;

  @ValidateIf((dto) => dto.publicReplyEnabled)
  @IsString()
  publicReplyText?: string;

  @IsBoolean()
  privateReplyEnabled!: boolean;

  @ValidateIf((dto) => dto.privateReplyEnabled)
  @IsString()
  privateReplyText?: string;

  @IsBoolean()
  enabled!: boolean;
}

export class UpdateInstagramCommentAutomationDto {
  @IsEnum(InstagramCommentMatchType)
  matchType!: InstagramCommentMatchType;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  triggers!: string[];

  @IsBoolean()
  publicReplyEnabled!: boolean;

  @ValidateIf((dto) => dto.publicReplyEnabled)
  @IsString()
  publicReplyText?: string;

  @IsBoolean()
  privateReplyEnabled!: boolean;

  @ValidateIf((dto) => dto.privateReplyEnabled)
  @IsString()
  privateReplyText?: string;

  @IsBoolean()
  enabled!: boolean;
}

export class InstagramCommentAutomationStatusDto {
  @IsBoolean()
  enabled!: boolean;
}

export class InstagramCommentExecutionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class InstagramMediaQueryDto {
  @IsOptional()
  @IsString()
  after?: string;
}
