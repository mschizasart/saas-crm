import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ValidationRulesService } from './validation-rules.service';
import { RuleCondition } from './condition-evaluator';

// ── DTOs ──────────────────────────────────────────────────────
class CreateValidationRuleBody {
  @IsString()
  @IsNotEmpty()
  fieldTo!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['AND', 'OR', 'and', 'or'])
  conditionLogic?: string;

  @IsArray()
  conditions!: RuleCondition[];

  @IsString()
  @IsNotEmpty()
  errorMessage!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateValidationRuleBody {
  @IsOptional()
  @IsString()
  fieldTo?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['AND', 'OR', 'and', 'or'])
  conditionLogic?: string;

  @IsOptional()
  @IsArray()
  conditions?: RuleCondition[];

  @IsOptional()
  @IsString()
  errorMessage?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  order?: number;
}

class TestValidationRuleBody {
  @IsString()
  @IsNotEmpty()
  fieldTo!: string;

  @IsOptional()
  @IsIn(['AND', 'OR', 'and', 'or'])
  conditionLogic?: string;

  @IsArray()
  conditions!: RuleCondition[];

  @IsObject()
  sampleRecord!: Record<string, any>;
}

@ApiTags('Validation Rules')
@ApiBearerAuth()
@Controller({ version: '1', path: 'validation-rules' })
@UseGuards(JwtAuthGuard, RbacGuard)
export class ValidationRulesController {
  constructor(private readonly service: ValidationRulesService) {}

  @Get()
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'List validation rules (optionally by fieldTo)' })
  findAll(@CurrentOrg() org: any, @Query('fieldTo') fieldTo?: string) {
    return this.service.findAll(org.id, fieldTo);
  }

  @Post()
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Create a validation rule' })
  create(@CurrentOrg() org: any, @Body() body: CreateValidationRuleBody) {
    return this.service.create(org.id, body);
  }

  @Patch(':id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Update a validation rule' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: UpdateValidationRuleBody,
  ) {
    return this.service.update(org.id, id, body);
  }

  @Delete(':id')
  @Permissions('settings.edit')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a validation rule' })
  async delete(@CurrentOrg() org: any, @Param('id') id: string) {
    await this.service.delete(org.id, id);
  }

  @Post('test')
  @Permissions('settings.edit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Dry-run an unsaved rule against a sample record',
  })
  test(@Body() body: TestValidationRuleBody) {
    return this.service.test(body);
  }
}
