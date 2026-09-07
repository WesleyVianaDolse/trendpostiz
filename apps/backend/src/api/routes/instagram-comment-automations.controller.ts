import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { InstagramCommentAutomationCrudService } from '@gitroom/backend/services/instagram-comment-automations/instagram-comment-automation-crud.service';
import {
  CreateInstagramCommentAutomationDto,
  InstagramCommentAutomationStatusDto,
  InstagramCommentExecutionsQueryDto,
  InstagramMediaQueryDto,
  UpdateInstagramCommentAutomationDto,
} from '@gitroom/backend/services/instagram-comment-automations/instagram-comment-automation.dto';

@ApiTags('Instagram comment automations')
@Controller('/instagram-comment-automations')
export class InstagramCommentAutomationsController {
  constructor(
    private readonly service: InstagramCommentAutomationCrudService
  ) {}

  @Get('/accounts')
  accounts(@GetOrgFromRequest() org: Organization) {
    return this.service.listAccounts(org.id);
  }

  @Get('/integrations/:integrationId/media')
  media(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Query() query: InstagramMediaQueryDto
  ) {
    return this.service.listMedia(org.id, integrationId, query.after);
  }

  @Get('/')
  list(@GetOrgFromRequest() org: Organization) {
    return this.service.list(org.id);
  }

  @Get('/:id')
  get(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this.service.get(org.id, id);
  }

  @Post('/')
  create(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateInstagramCommentAutomationDto
  ) {
    return this.service.create(org.id, body);
  }

  @Put('/:id')
  update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateInstagramCommentAutomationDto
  ) {
    return this.service.update(org.id, id, body);
  }

  @Patch('/:id/status')
  status(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: InstagramCommentAutomationStatusDto
  ) {
    return this.service.setStatus(org.id, id, body.enabled);
  }

  @Delete('/:id')
  remove(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }

  @Get('/:id/executions')
  executions(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query() query: InstagramCommentExecutionsQueryDto
  ) {
    return this.service.executions(org.id, id, query);
  }
}
