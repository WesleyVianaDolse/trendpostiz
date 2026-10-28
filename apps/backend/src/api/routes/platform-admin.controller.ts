import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Max,
  Min,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { User } from '@prisma/client';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { PlatformService } from '@gitroom/nestjs-libraries/database/prisma/platform/platform.service';

export class AdminListQuery {
  @IsOptional() @IsString() @MaxLength(200) search = '';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) page = 0;
}
export class PlatformSettingsDto {
  @IsBoolean() registrationEnabled: boolean;
  @IsBoolean() organizationCreationEnabled: boolean;
}
export class AdminSuspensionDto {
  @IsBoolean() suspended: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class AdminUserStatusDto {
  @IsBoolean() disabled: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class AdminPermissionDto {
  @IsBoolean() enabled: boolean;
}
export class AdminCreateOrganizationDto {
  @IsString() @Length(1, 160) @Matches(/\S/) name: string;
  @IsOptional() @IsString() @Length(1, 100) ownerUserId?: string;
  @IsOptional() @IsEmail() @MaxLength(254) ownerEmail?: string;
  @IsOptional() @IsString() @Length(1, 160) @Matches(/\S/) ownerName?: string;
  @IsOptional() @IsString() @Length(12, 128) ownerPassword?: string;
}
export class AdminCreateUserDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(1, 160) @Matches(/\S/) name: string;
  @IsString() @Length(12, 128) password: string;
  @IsString() @Length(1, 100) organizationId: string;
  @IsIn(['USER', 'ADMIN']) role: 'USER' | 'ADMIN';
}

@Controller('/platform-admin')
export class PlatformAdminController {
  constructor(private readonly platform: PlatformService) {}
  @Get('/session')
  async session(@GetUserFromRequest() user: User) {
    const settings = await this.platform.settings();
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isOwner: user.id === settings.ownerUserId,
    };
  }
  @Get('/overview') overview() {
    return this.platform.overview();
  }
  @Get('/settings') settings() {
    return this.platform.settings();
  }
  @Patch('/settings') updateSettings(
    @GetUserFromRequest() user: User,
    @Body() body: PlatformSettingsDto
  ) {
    return this.platform.updateSettings(user.id, {
      registrationEnabled: body.registrationEnabled,
      organizationCreationEnabled: body.organizationCreationEnabled,
    });
  }
  @Get('/organizations') organizations(@Query() query: AdminListQuery) {
    return this.platform.organizations(query.search, query.page);
  }
  @Get('/organizations/:id') organization(@Param('id') id: string) {
    return this.platform.organization(id);
  }
  @Post('/organizations') createOrganization(
    @GetUserFromRequest() user: User,
    @Body() body: AdminCreateOrganizationDto
  ) {
    return this.platform.createOrganization(
      user.id,
      body.name,
      body.ownerUserId,
      body.ownerEmail
        ? {
            name: body.ownerName,
            email: body.ownerEmail,
            password: body.ownerPassword,
          }
        : undefined
    );
  }
  @Patch('/organizations/:id/suspension') suspend(
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: AdminSuspensionDto
  ) {
    return this.platform.setSuspended(user.id, id, body.suspended, body.reason);
  }
  @Get('/users') users(@Query() query: AdminListQuery) {
    return this.platform.users(query.search, query.page);
  }
  @Post('/users') createUser(
    @GetUserFromRequest() user: User,
    @Body() body: AdminCreateUserDto
  ) {
    return this.platform.createUser(user.id, body);
  }
  @Patch('/users/:id/status') userStatus(
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: AdminUserStatusDto
  ) {
    return this.platform.setUserDisabled(
      user.id,
      id,
      body.disabled,
      body.reason
    );
  }
  @Patch('/users/:id/admin') permission(
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: AdminPermissionDto
  ) {
    return this.platform.setAdmin(user.id, id, body.enabled);
  }
  @Get('/audit') audit(@Query() query: AdminListQuery) {
    return this.platform.audit(query.page);
  }
}
