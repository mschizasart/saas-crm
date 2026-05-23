import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  TaxConfigService,
  UpsertTaxSettingsDto,
} from './tax-config.service';
import { CalculateTaxDto } from './dto/calculate-tax.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

/**
 * Per-tenant tax-automation configuration + on-demand calculation.
 * Mirrors AiSettingsController: GET (redacted) / PUT (upsert, encrypt-on-write)
 * / POST test, plus a POST /calculate used by the invoice "Calculate tax" button.
 */
@ApiTags('Tax')
@Controller({ version: '1', path: 'tax' })
@ApiBearerAuth()
export class TaxController {
  constructor(private service: TaxConfigService) {}

  @Get('settings')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.view')
  @ApiOperation({ summary: 'Get this org tax-automation settings (API key redacted)' })
  getSettings(@CurrentOrg() org: any) {
    return this.service.getForOrg(org.id);
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Upsert tax-automation settings for this org' })
  upsert(@CurrentOrg() org: any, @Body() body: UpsertTaxSettingsDto) {
    return this.service.upsert(org.id, body);
  }

  @Post('settings/test')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Test the tax-provider connection with a sample order — uses saved config when body is empty, or an override (provider/apiKey/avalara*) to test before saving',
  })
  test(@CurrentOrg() org: any, @Body() body: UpsertTaxSettingsDto = {}) {
    const override =
      body.provider && body.provider !== 'NONE' ? body : undefined;
    return this.service.testConnection(org.id, override);
  }

  @Post('calculate')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('invoices.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Compute tax for an invoice/estimate via the configured provider. Applies the result to the entity totals when autoApply is on.',
  })
  async calculate(
    @CurrentOrg() org: any,
    @Body() body: CalculateTaxDto,
  ) {
    const entityType = body.entityType ?? 'invoice';
    // When autoApply is on, the manual "Calculate tax" button should also
    // persist the result; otherwise it's a preview the user reviews first.
    const settings = await this.service.getForOrg(org.id);
    return this.service.calculateForInvoice(org.id, body.entityId, {
      entityType,
      applyToEntity: settings.autoApply,
    });
  }
}
