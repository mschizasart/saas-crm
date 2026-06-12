import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ActivityCaptureSettingsService } from './activity-capture-settings.service';
import { UpdateSettingsDto } from './activity-capture.dto';

/**
 * Tenant-facing CRUD for the capture toggles (Wave H2).
 *
 * Gated by the existing `settings.view` / `settings.edit` permissions
 * — no new RBAC entries are needed (Wave H2 deliberately stays inside
 * the existing settings scope).
 */
@ApiTags('Activity Capture')
@Controller({ version: '1', path: 'activity-capture/settings' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ActivityCaptureSettingsController {
  constructor(private service: ActivityCaptureSettingsService) {}

  @Get()
  @Permissions('settings.view')
  @ApiOperation({ summary: 'Read activity-capture toggles for this org' })
  get(@CurrentOrg() org: any) {
    return this.service.get(org.id);
  }

  @Put()
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Update activity-capture toggles' })
  update(@CurrentOrg() org: any, @Body() dto: UpdateSettingsDto) {
    return this.service.update(org.id, dto);
  }
}
