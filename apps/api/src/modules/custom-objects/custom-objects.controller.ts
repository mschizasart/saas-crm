import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateCustomObjectDto,
  CreateFieldDto,
  CustomObjectsService,
  UpdateCustomObjectDto,
  UpdateFieldDto,
} from './custom-objects.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Custom Objects')
@Controller({ version: '1', path: 'custom-objects' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class CustomObjectsController {
  constructor(private service: CustomObjectsService) {}

  // ─── Object CRUD ─────────────────────────────────────────────

  @Get()
  @Permissions('custom-objects.view')
  @ApiOperation({ summary: 'List custom object definitions for the org' })
  list(@CurrentOrg() org: any) {
    return this.service.list(org.id);
  }

  @Get(':id')
  @Permissions('custom-objects.view')
  @ApiOperation({ summary: 'Get a single custom object with its fields' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('custom-objects.configure')
  @ApiOperation({ summary: 'Create a custom object definition' })
  create(@CurrentOrg() org: any, @Body() dto: CreateCustomObjectDto) {
    return this.service.create(org.id, dto);
  }

  @Put(':id')
  @Permissions('custom-objects.configure')
  @ApiOperation({ summary: 'Update a custom object (slug is immutable)' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateCustomObjectDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('custom-objects.configure')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a custom object (refuses if records exist)',
  })
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }

  // ─── Field CRUD ──────────────────────────────────────────────

  @Post(':id/fields')
  @Permissions('custom-objects.configure')
  @ApiOperation({ summary: 'Add a field to a custom object' })
  addField(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: CreateFieldDto,
  ) {
    return this.service.addField(org.id, id, dto);
  }

  @Put(':id/fields/:fieldId')
  @Permissions('custom-objects.configure')
  @ApiOperation({
    summary: 'Update a field (type change blocked once records exist)',
  })
  updateField(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('fieldId') fieldId: string,
    @Body() dto: UpdateFieldDto,
  ) {
    return this.service.updateField(org.id, id, fieldId, dto);
  }

  @Delete(':id/fields/:fieldId')
  @Permissions('custom-objects.configure')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a field and strip its key from every existing record',
  })
  deleteField(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('fieldId') fieldId: string,
  ) {
    return this.service.deleteField(org.id, id, fieldId);
  }

  @Post(':id/fields/reorder')
  @Permissions('custom-objects.configure')
  @ApiOperation({ summary: 'Bulk re-order fields' })
  reorderFields(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { orderMap: Array<{ id: string; order: number }> },
  ) {
    return this.service.reorderFields(org.id, id, body?.orderMap ?? []);
  }
}
