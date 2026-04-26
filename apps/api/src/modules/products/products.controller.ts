import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProductsService, CreateProductDto } from './products.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { buildCsv, csvFilename } from '../../common/csv/csv-writer';

@ApiTags('Products')
@Controller({ version: '1', path: 'products' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ProductsController {
  constructor(private service: ProductsService) {}

  @Get('low-stock')
  @Permissions('products.view')
  @ApiOperation({ summary: 'Get products with stock below alert threshold' })
  lowStock(@CurrentOrg() org: any) {
    return this.service.getLowStockProducts(org.id);
  }

  // ─── CSV Export ────────────────────────────────────────────
  @Get('export')
  @Permissions('products.view')
  @ApiOperation({ summary: 'Export products as CSV (respects current filters)' })
  async exportCsv(
    @CurrentOrg() org: any,
    @Res() res: any,
    @Query('search') search?: string,
    @Query('active') active?: string,
  ) {
    const { rows, truncated } = await this.service.findAllForExport(org.id, {
      search,
      active: active !== undefined ? active === 'true' : undefined,
    });

    const csv = buildCsv({
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'sku', label: 'SKU' },
        { key: 'description', label: 'Description' },
        { key: 'unitPrice', label: 'Unit Price' },
        { key: 'costPrice', label: 'Cost Price' },
        { key: 'taxRate', label: 'Tax Rate' },
        { key: 'unit', label: 'Unit' },
        { key: 'stockQuantity', label: 'Stock' },
        { key: 'lowStockAlert', label: 'Low Stock Alert' },
        { key: 'trackInventory', label: 'Track Inventory' },
        { key: 'active', label: 'Active' },
      ],
      rows,
    });

    const filename = csvFilename('products');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
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

  // Legacy route kept for backward compatibility — same semantics as the new
  // /stock/adjust endpoint but with `{quantity}` payload.
  @Patch(':id/stock')
  @ApiOperation({ summary: 'Adjust stock (legacy)' })
  legacyAdjustStock(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { quantity: number; reason?: string; note?: string },
  ) {
    return this.service.adjustStock(
      org.id,
      id,
      Number(body.quantity),
      body.reason ?? 'manual_adjustment',
      user?.id,
      body.note,
    );
  }

  @Post(':id/stock/adjust')
  @Permissions('products.edit')
  @ApiOperation({
    summary: 'Adjust stock and record a StockMovement',
  })
  adjustStock(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { delta: number; reason: string; note?: string },
  ) {
    return this.service.adjustStock(
      org.id,
      id,
      Number(body.delta),
      body.reason ?? 'manual_adjustment',
      user?.id,
      body.note,
    );
  }

  @Get(':id/stock/movements')
  @Permissions('products.view')
  @ApiOperation({ summary: 'List stock movements for a product (paginated)' })
  movements(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getMovements(org.id, id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a product' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }
}
