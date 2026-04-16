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
import { ProductsService, CreateProductDto } from './products.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';

@ApiTags('Products')
@Controller({ version: '1', path: 'products' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ProductsController {
  constructor(private service: ProductsService) {}

  @Get('low-stock')
  @ApiOperation({ summary: 'Get products with stock below alert threshold' })
  lowStock(@CurrentOrg() org: any) {
    return this.service.getLowStockProducts(org.id);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search products (for autocomplete)' })
  search(@CurrentOrg() org: any, @Query('q') q: string) {
    return this.service.search(org.id, q ?? '');
  }

  @Get()
  @ApiOperation({ summary: 'List all products (paginated)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('active') active?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      active: active !== undefined ? active === 'true' : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single product' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new product' })
  create(@CurrentOrg() org: any, @Body() dto: CreateProductDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a product' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateProductDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Patch(':id/stock')
  @ApiOperation({ summary: 'Adjust stock quantity' })
  adjustStock(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { quantity: number; reason?: string },
  ) {
    return this.service.adjustStock(org.id, id, body.quantity, body.reason);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a product' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }
}
