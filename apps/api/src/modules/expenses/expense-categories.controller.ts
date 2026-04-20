import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

interface CategoryDto {
  name: string;
  color?: string | null;
}

@ApiTags('Expense Categories')
@Controller({ version: '1', path: 'expenses/categories' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpensesService) {}

  @Get()
  @Permissions('expenses.view')
  @ApiOperation({ summary: 'List all expense categories' })
  findAll(@CurrentOrg() org: any) {
    return this.service.getCategories(org.id);
  }

  @Post()
  @Permissions('expenses.edit')
  @ApiOperation({ summary: 'Create an expense category' })
  create(@CurrentOrg() org: any, @Body() dto: CategoryDto) {
    return this.service.createCategory(org.id, dto.name, dto.color ?? undefined);
  }

  @Patch(':id')
  @Permissions('expenses.edit')
  @ApiOperation({ summary: 'Update an expense category' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CategoryDto>,
  ) {
    return this.service.updateCategory(org.id, id, {
      name: dto.name,
      color: dto.color,
    });
  }

  @Delete(':id')
  @Permissions('expenses.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an expense category (rejects if linked expenses exist)',
  })
  async delete(@CurrentOrg() org: any, @Param('id') id: string) {
    await this.service.deleteCategory(org.id, id);
  }
}
