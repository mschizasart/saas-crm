import {
  Controller,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ImportsService } from './imports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Imports')
@Controller({ version: '1', path: 'imports' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ImportsController {
  constructor(private service: ImportsService) {}

  @Post('clients')
  @Permissions('clients.create')
  @ApiOperation({ summary: 'Import clients from CSV data' })
  importClients(
    @CurrentOrg() org: any,
    @Body() body: { csv: string },
  ) {
    return this.service.importClients(org.id, body.csv);
  }

  @Post('leads')
  @Permissions('leads.create')
  @ApiOperation({ summary: 'Import leads from CSV data' })
  importLeads(
    @CurrentOrg() org: any,
    @Body() body: { csv: string },
  ) {
    return this.service.importLeads(org.id, body.csv);
  }
}
