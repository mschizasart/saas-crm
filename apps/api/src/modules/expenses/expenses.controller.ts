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
import { ExpensesService, CreateExpenseDto } from './expenses.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Expenses')
@Controller({ version: '1', path: 'expenses' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ExpensesController {
  constructor(private service: ExpensesService) {}

  // ─── Categories ────────────────────────────────────────────────────────────

  @Get('categories')
  @ApiOperation({ summary: 'List expense categories' })
  getCategories(@CurrentOrg() org: any) {
    return this.service.getCategories(org.id);
  }

  @Post('categories')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Create an expense category' })
  createCategory(
    @CurrentOrg() org: any,
    @Body() body: { name: string; color?: string },
  ) {
    return this.service.createCategory(org.id, body.name, body.color);
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Get expense stats for the current (or given) month' })
  getStats(
    @CurrentOrg() org: any,
    @Query('month') month?: string,
  ) {
    return this.service.getStats(org.id, month);
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List all expenses (paginated, filterable)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('clientId') clientId?: string,
    @Query('projectId') projectId?: string,
    @Query('billable') billable?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      categoryId,
      clientId,
      projectId,
      billable: billable !== undefined ? billable === 'true' : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // ─── Single ────────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get a single expense' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  @Post()
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Log a new expense' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({ summary: 'Update an expense' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateExpenseDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an expense' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }
}
