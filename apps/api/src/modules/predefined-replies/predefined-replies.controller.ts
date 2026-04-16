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
import { PredefinedRepliesService, CreatePredefinedReplyDto } from './predefined-replies.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Predefined Replies')
@Controller({ version: '1', path: 'predefined-replies' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class PredefinedRepliesController {
  constructor(private service: PredefinedRepliesService) {}

  @Get()
  @Permissions('tickets.view')
  @ApiOperation({ summary: 'List predefined replies (search supported)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(org.id, { search });
  }

  @Get(':id')
  @Permissions('tickets.view')
  @ApiOperation({ summary: 'Get a single predefined reply' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('tickets.create')
  @ApiOperation({ summary: 'Create a predefined reply' })
  create(@CurrentOrg() org: any, @Body() dto: CreatePredefinedReplyDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @Permissions('tickets.edit')
  @ApiOperation({ summary: 'Update a predefined reply' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreatePredefinedReplyDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('tickets.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a predefined reply' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }
}
