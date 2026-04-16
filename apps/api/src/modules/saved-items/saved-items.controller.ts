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
import { SavedItemsService, CreateSavedItemDto } from './saved-items.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Saved Items')
@Controller({ version: '1', path: 'saved-items' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class SavedItemsController {
  constructor(private service: SavedItemsService) {}

  @Get()
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'List saved items (optionally search by description)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(org.id, { search });
  }

  @Get(':id')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Get a single saved item' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('invoices.create')
  @ApiOperation({ summary: 'Create a saved item' })
  create(@CurrentOrg() org: any, @Body() dto: CreateSavedItemDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Update a saved item' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateSavedItemDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('invoices.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a saved item' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }
}
