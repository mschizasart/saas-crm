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

import { PipelinesService } from './pipelines.service';
import {
  CreateStageDto,
  UpdateStageDto,
  ReorderStageItem,
} from './opportunities.dto';
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Pipelines')
@Controller({ version: '1', path: 'pipelines' })
@UseGuards(JwtOrApiKeyGuard, RbacGuard)
@ApiBearerAuth()
export class PipelinesController {
  constructor(private service: PipelinesService) {}

  // ─── Stages CRUD ─────────────────────────────────────────────

  @Get('stages')
  @Permissions('opportunities.view')
  @ApiOperation({ summary: 'List pipeline stages (ordered)' })
  list(@CurrentOrg() org: any) {
    return this.service.list(org.id);
  }

  @Post('stages')
  @Permissions('opportunities.configure')
  @ApiOperation({ summary: 'Create a new pipeline stage' })
  create(@CurrentOrg() org: any, @Body() dto: CreateStageDto) {
    return this.service.create(org.id, dto);
  }

  @Put('stages/:id')
  @Permissions('opportunities.configure')
  @ApiOperation({ summary: 'Update a pipeline stage' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateStageDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete('stages/:id')
  @Permissions('opportunities.configure')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a stage (refused if any deal uses it)' })
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }

  @Post('stages/reorder')
  @Permissions('opportunities.configure')
  @ApiOperation({ summary: 'Bulk-update the order of pipeline stages' })
  reorder(
    @CurrentOrg() org: any,
    @Body() body: ReorderStageItem[],
  ) {
    return this.service.reorder(org.id, body);
  }
}
