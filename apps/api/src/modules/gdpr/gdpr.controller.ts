import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { GdprService } from './gdpr.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('GDPR')
@Controller({ version: '1', path: 'gdpr' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class GdprController {
  constructor(private service: GdprService) {}

  @Get('export/user/:id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Export all data for a staff user' })
  exportUser(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.exportUserData(org.id, id);
  }

  @Get('export/client/:id')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Export all data for a client' })
  exportClient(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.exportClientData(org.id, id);
  }

  @Post('anonymize/user/:id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anonymize a user (right to be forgotten)' })
  anonymize(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.anonymizeUser(org.id, id);
  }

  @Delete('client/:id/complete')
  @Permissions('clients.delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hard-delete a client and all related data' })
  deleteClient(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.deleteClientCompletely(org.id, id);
  }

  @Get('retention-report')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Get data retention report' })
  retentionReport(@CurrentOrg() org: any) {
    return this.service.getDataRetentionReport(org.id);
  }
}
