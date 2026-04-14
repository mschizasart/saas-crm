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
import { ClientsService, CreateClientDto, CreateContactDto } from './clients.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Clients')
@Controller({ version: '1', path: 'clients' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ClientsController {
  constructor(private service: ClientsService) {}

  // ─── Client CRUD ───────────────────────────────────────────

  @Get()
  @Permissions('clients.view')
  @ApiOperation({ summary: 'List all clients (paginated, searchable)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('active') active?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      active: active !== undefined ? active === 'true' : undefined,
    });
  }

  @Get(':id')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get single client with contacts and stats' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('clients.create')
  @ApiOperation({ summary: 'Create a new client' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateClientDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  @Patch(':id')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Update client details' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateClientDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('clients.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a client' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  @Patch(':id/toggle-active')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Toggle client active/inactive status' })
  toggleActive(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.toggleActive(org.id, id);
  }

  // ─── Contacts ──────────────────────────────────────────────

  @Get(':id/contacts')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'List contacts for a client' })
  getContacts(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getContacts(org.id, id);
  }

  @Post(':id/contacts')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Add a contact to a client' })
  createContact(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.service.createContact(org.id, id, dto);
  }

  // ─── Statement ─────────────────────────────────────────────

  @Get(':id/statement')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get client financial statement (invoices + payments)' })
  getStatement(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getStatement(org.id, id);
  }

  // ─── Groups ────────────────────────────────────────────────

  @Get('groups/list')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'List all client groups' })
  getGroups(@CurrentOrg() org: any) {
    return this.service.getGroups(org.id);
  }

  @Post('groups')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Create a client group' })
  createGroup(@CurrentOrg() org: any, @Body() body: { name: string }) {
    return this.service.createGroup(org.id, body.name);
  }
}
