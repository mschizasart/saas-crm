import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  CampaignsService,
  CreateCampaignDto,
  UpdateCampaignDto,
} from './campaigns.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

/**
 * Bulk email campaigns / newsletters.
 *
 * Gated by the new `campaigns.manage` permission (registered in the roles
 * catalogue). Admin/owner tiers bypass RBAC via RbacGuard, so this is
 * effectively admin + anyone explicitly granted campaigns.manage.
 */
@ApiTags('Campaigns')
@Controller({ version: '1', path: 'campaigns' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Get()
  @Permissions('campaigns.manage')
  @ApiOperation({ summary: 'List campaigns with open-rate aggregates' })
  findAll(@CurrentOrg() org: any) {
    return this.service.findAll(org.id);
  }

  @Post()
  @Permissions('campaigns.manage')
  @ApiOperation({ summary: 'Create a campaign (draft or scheduled)' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.service.create(org.id, dto, user?.id);
  }

  @Get(':id')
  @Permissions('campaigns.manage')
  @ApiOperation({ summary: 'Get a single campaign' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Put(':id')
  @Permissions('campaigns.manage')
  @ApiOperation({ summary: 'Update a campaign (blocked once sending/sent)' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('campaigns.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a campaign' })
  async remove(@CurrentOrg() org: any, @Param('id') id: string) {
    await this.service.remove(org.id, id);
  }

  @Post(':id/preview-recipients')
  @HttpCode(HttpStatus.OK)
  @Permissions('campaigns.manage')
  @ApiOperation({
    summary: 'Resolve the segment to a recipient count + sample (no send)',
  })
  preview(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.previewRecipients(org.id, id);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('campaigns.manage')
  @ApiOperation({
    summary: 'Materialise recipients (dedup) and enqueue the send',
  })
  send(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.send(org.id, id);
  }

  @Get(':id/stats')
  @Permissions('campaigns.manage')
  @ApiOperation({ summary: 'Sent/failed + aggregate opens/clicks' })
  stats(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.stats(org.id, id);
  }
}
