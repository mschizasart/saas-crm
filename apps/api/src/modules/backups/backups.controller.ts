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
import { BackupsService } from './backups.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Backups')
@Controller({ version: '1', path: 'backups' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class BackupsController {
  constructor(private service: BackupsService) {}

  @Get()
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'List backups for current org' })
  list(@CurrentOrg() org: any) {
    return this.service.listBackups(org.id);
  }

  @Post()
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Trigger a manual backup' })
  create(@CurrentOrg() org: any) {
    return this.service.createBackup(org.id);
  }

  @Get(':filename/download')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Get a presigned download URL for a backup' })
  download(@CurrentOrg() org: any, @Param('filename') filename: string) {
    return this.service.downloadBackup(org.id, filename);
  }

  @Delete(':filename')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a backup' })
  async remove(@CurrentOrg() org: any, @Param('filename') filename: string) {
    await this.service.deleteBackup(org.id, filename);
  }
}
