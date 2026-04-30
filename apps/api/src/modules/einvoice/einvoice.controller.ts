import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  EinvoiceService,
  EInvoiceSettingsDto,
  EINVOICE_FORMATS,
} from './einvoice.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('E-Invoice')
@Controller({ version: '1', path: 'einvoice' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class EinvoiceController {
  constructor(private service: EinvoiceService) {}

  // ─── Settings ────────────────────────────────────────────────────────────

  @Get('settings')
  @Permissions('settings.view')
  @ApiOperation({
    summary:
      'Get this org e-invoice settings — creates a default row on first read',
  })
  async getSettings(@CurrentOrg() org: any) {
    return this.service.getOrCreateForOrg(org.id);
  }

  @Put('settings')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Upsert e-invoice settings for this org' })
  async upsertSettings(
    @CurrentOrg() org: any,
    @Body() body: EInvoiceSettingsDto,
  ) {
    this.validate(body);
    return this.service.upsertForOrg(org.id, body);
  }

  // ─── XML preview / sample ───────────────────────────────────────────────

  @Get('preview/:invoiceId')
  @Permissions('settings.view')
  @ApiOperation({
    summary:
      'Render the UBL XML for an existing invoice using the current settings',
  })
  async previewForInvoice(
    @CurrentOrg() org: any,
    @Param('invoiceId') invoiceId: string,
  ): Promise<{ xml: string }> {
    const xml = await this.service.generateForInvoiceId(org.id, invoiceId);
    return { xml };
  }

  @Get('sample')
  @Permissions('settings.view')
  @ApiOperation({
    summary:
      'Render a sample UBL XML built from a synthetic invoice — no DB hit, useful for previewing the schema',
  })
  async sample(@CurrentOrg() org: any): Promise<{ xml: string }> {
    const xml = await this.service.generateSample(org.id);
    return { xml };
  }

  // ─── Validation ──────────────────────────────────────────────────────────

  /**
   * Light, format-only validation. Anything stricter (e.g. checksum on a GLN)
   * we leave to external validators — tenants are typically validating
   * generated XML against PEPPOL's schematron before issuing, so failing
   * loudly here would just be noise.
   */
  private validate(dto: EInvoiceSettingsDto): void {
    if (dto.format !== undefined && !EINVOICE_FORMATS.includes(dto.format)) {
      throw new BadRequestException(
        `format must be one of: ${EINVOICE_FORMATS.join(', ')}`,
      );
    }
    if (
      dto.senderCountry &&
      (typeof dto.senderCountry !== 'string' || dto.senderCountry.length !== 2)
    ) {
      throw new BadRequestException(
        'senderCountry must be a 2-letter ISO 3166-1 alpha-2 code',
      );
    }
    if (
      dto.senderIdScheme &&
      !/^\d{4}$/.test(String(dto.senderIdScheme))
    ) {
      throw new BadRequestException(
        'senderIdScheme must be a 4-digit numeric PEPPOL ICD code (e.g. 0088)',
      );
    }
    if (
      dto.defaultCurrency &&
      !/^[A-Z]{3}$/.test(String(dto.defaultCurrency))
    ) {
      throw new BadRequestException(
        'defaultCurrency must be a 3-letter ISO 4217 code',
      );
    }
    if (
      dto.paymentMeansCode &&
      !/^\d{1,3}$/.test(String(dto.paymentMeansCode))
    ) {
      throw new BadRequestException(
        'paymentMeansCode must be a numeric UN/CEFACT 4461 code',
      );
    }
  }
}
