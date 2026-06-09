import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { ProductBundlesService } from './product-bundles.service';
import { CreateBundleDto, UpdateBundleDto } from './cpq.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('CPQ — Product Bundles')
@Controller({ version: '1', path: 'product-bundles' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ProductBundlesController {
  constructor(private service: ProductBundlesService) {}

  @Get()
  @Permissions('quotes.view')
  @ApiOperation({ summary: 'List product bundles (paginated)' })
  list(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('active') active?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(org.id, {
      search,
      active: active === undefined ? undefined : active === 'true',
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @Permissions('quotes.view')
  @ApiOperation({ summary: 'Fetch a single bundle with its items' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('quotes.configure')
  @ApiOperation({ summary: 'Create a new product bundle' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateBundleDto,
  ) {
    return this.service.create(org.id, user.id, dto);
  }

  @Put(':id')
  @Permissions('quotes.configure')
  @ApiOperation({ summary: 'Update a bundle (replaces line items if provided)' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateBundleDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('quotes.configure')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a bundle (refused if referenced by draft quotes)' })
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }
}
