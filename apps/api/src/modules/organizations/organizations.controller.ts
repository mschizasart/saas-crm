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
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Organizations')
@Controller({ version: '1', path: 'organizations' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class OrganizationsController {
  constructor(private service: OrganizationsService) {}

  @Get('current')
  async getCurrent(@CurrentOrg() org: any) {
    return org;
  }

  @Patch('profile')
  @Permissions('settings.edit')
  async updateProfile(@CurrentOrg() org: any, @Body() body: any) {
    return this.service.updateProfile(org.id, body);
  }

  @Patch('settings')
  @Permissions('settings.edit')
  async updateSettings(@CurrentOrg() org: any, @Body() body: any) {
    return this.service.updateSettings(org.id, body);
  }

  @Get('usage')
  async getUsage(@CurrentOrg() org: any) {
    return this.service.getUsageStats(org.id);
  }

  // ─── Taxes ─────────────────────────────────────────────────

  @Get('taxes')
  async getTaxes(@CurrentOrg() org: any) {
    return this.service.getTaxes(org.id);
  }

  @Post('taxes')
  @Permissions('settings.edit')
  async createTax(@CurrentOrg() org: any, @Body() body: { name: string; rate: number }) {
    return this.service.createTax(org.id, body.name, body.rate);
  }

  @Patch('taxes/:id')
  @Permissions('settings.edit')
  async updateTax(@CurrentOrg() org: any, @Param('id') id: string, @Body() body: { name?: string; rate?: number }) {
    return this.service.updateTax(org.id, id, body);
  }

  @Delete('taxes/:id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTax(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.deleteTax(org.id, id);
  }

  // ─── Currencies ───────────────────────────────────────────

  @Get('currencies')
  async getCurrencies(@CurrentOrg() org: any) {
    return this.service.getCurrencies(org.id);
  }

  @Post('currencies')
  @Permissions('settings.edit')
  async createCurrency(@CurrentOrg() org: any, @Body() body: { name: string; symbol: string; symbolPlacement?: string; decimalSeparator?: string; thousandSeparator?: string; decimalPlaces?: number; isDefault?: boolean; exchangeRate?: number }) {
    return this.service.createCurrency(org.id, body);
  }

  @Patch('currencies/:id')
  @Permissions('settings.edit')
  async updateCurrency(@CurrentOrg() org: any, @Param('id') id: string, @Body() body: any) {
    return this.service.updateCurrency(org.id, id, body);
  }

  @Delete('currencies/:id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCurrency(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.deleteCurrency(org.id, id);
  }
}
