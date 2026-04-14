import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Organizations')
@Controller({ version: '1', path: 'organizations' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class OrganizationsController {
  constructor(private service: OrganizationsService) {}

  @Get('current')
  async getCurrent(@CurrentOrg() org: any) {
    return org;
  }

  @Patch('profile')
  @Permissions('settings.edit')
  async updateProfile(@CurrentOrg() org: any, @Body() body: any) {
    return this.service.updateProfile(org.id, body);
  }

  @Patch('settings')
  @Permissions('settings.edit')
  async updateSettings(@CurrentOrg() org: any, @Body() body: any) {
    return this.service.updateSettings(org.id, body);
  }

  @Get('usage')
  async getUsage(@CurrentOrg() org: any) {
    return this.service.getUsageStats(org.id);
  }
}
