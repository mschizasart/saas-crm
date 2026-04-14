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
import {
  VaultService,
  CreateVaultDto,
  UpdateVaultDto,
} from './vault.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Vault')
@Controller({ version: '1', path: 'vault' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class VaultController {
  constructor(private service: VaultService) {}

  @Get()
  @Permissions('clients.view')
  @ApiOperation({ summary: 'List vault entries' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('clientId') clientId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      clientId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get a single vault entry (password hidden)' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post(':id/reveal')
  @Permissions('clients.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reveal decrypted password for a vault entry' })
  reveal(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.reveal(org.id, id);
  }

  @Post()
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Create vault entry' })
  create(@CurrentOrg() org: any, @Body() dto: CreateVaultDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Update vault entry' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateVaultDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('clients.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete vault entry' })
  async remove(@CurrentOrg() org: any, @Param('id') id: string) {
    await this.service.delete(org.id, id);
  }
}
