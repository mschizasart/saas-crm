import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  AnnouncementsService,
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from './announcements.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Announcements')
@Controller({ version: '1', path: 'announcements' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class AnnouncementsController {
  constructor(private service: AnnouncementsService) {}

  @Get()
  @ApiOperation({ summary: 'List all announcements' })
  findAll(@CurrentOrg() org: any) {
    return this.service.findAll(org.id);
  }

  @Get('active')
  @ApiOperation({ summary: 'List active (non-dismissed) announcements' })
  findActive(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Query('audience') audience?: 'staff' | 'clients',
  ) {
    return this.service.findActive(
      org.id,
      audience ?? 'staff',
      user.id ?? user.sub,
    );
  }

  @Post()
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Create announcement' })
  create(@CurrentOrg() org: any, @Body() dto: CreateAnnouncementDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Update announcement' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete announcement' })
  async remove(@CurrentOrg() org: any, @Param('id') id: string) {
    await this.service.delete(org.id, id);
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Dismiss announcement for current user' })
  async dismiss(@CurrentUser() user: any, @Param('id') id: string) {
    await this.service.dismiss(user.id ?? user.sub, id);
  }
}
