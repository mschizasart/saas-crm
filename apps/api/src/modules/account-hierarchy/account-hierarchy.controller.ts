import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AccountHierarchyService } from './account-hierarchy.service';
import { SetParentDto } from './account-hierarchy.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

// ─── Account hierarchy controller (Wave F1) ─────────────────────
//
// Mounted on the same `clients` path as ClientsController — Fastify
// routes static segments (e.g. `roots`) ahead of parameterized ones
// (e.g. `:id`), so `GET /clients/roots` resolves here without
// conflicting with `GET /clients/:id`.
//
// Reuses the existing `clients.view` / `clients.edit` permissions —
// no new RBAC keys needed.

@ApiTags('Account hierarchy')
@Controller({ version: '1', path: 'clients' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class AccountHierarchyController {
  constructor(private readonly service: AccountHierarchyService) {}

  // ─── Reads ──────────────────────────────────────────────────

  @Get('roots')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'List root clients (no parent)' })
  getRoots(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.service.getRoots(org.id, {
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id/hierarchy')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get the full subtree rooted at this client' })
  getHierarchy(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getHierarchy(org.id, id);
  }

  @Get(':id/ancestors')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get the ancestor chain (oldest-first)' })
  getAncestors(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getAncestors(org.id, id);
  }

  @Get(':id/rollup')
  @Permissions('clients.view')
  @ApiOperation({
    summary:
      'Rollup metrics (self + descendants + combined) for the subtree.',
  })
  rollup(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.rollupMetrics(org.id, id);
  }

  // ─── Writes ─────────────────────────────────────────────────

  @Post(':id/set-parent')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Attach this client as a child of another' })
  setParent(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: SetParentDto,
  ) {
    return this.service.setParent(org.id, id, dto.parentClientId);
  }

  @Post(':id/unset-parent')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Detach this client from its parent (make it a root)' })
  unsetParent(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.unsetParent(org.id, id);
  }
}
