import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RecordSharingService } from './record-sharing.service';
import { SetManagerDto } from './record-sharing.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

// ─── Record sharing controller (Wave G1) ────────────────────────
//
// Mounted on `/users` and `/me` so the manager-chain reads sit
// naturally next to the user endpoints. Reuses `users.view` /
// `users.edit` — no new RBAC keys here. The new
// `records.sharing.*` permissions are read INSIDE the service
// helper, not at the route boundary.

@ApiTags('Record sharing')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class RecordSharingController {
  constructor(private readonly service: RecordSharingService) {}

  // ─── Reads ──────────────────────────────────────────────────

  @Get('users/with-managers')
  @Permissions('users.view')
  @ApiOperation({
    summary:
      'List all staff users with their managerId — backs the team-hierarchy admin page',
  })
  listStaffWithManagers(@CurrentOrg() org: any) {
    return this.service.listStaffWithManagers(org.id);
  }

  @Get('users/:id/manager-chain')
  @Permissions('users.view')
  @ApiOperation({ summary: 'Manager chain (ancestors, immediate-first)' })
  getManagerChain(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getManagerChain(org.id, id);
  }

  @Get('users/:id/direct-reports')
  @Permissions('users.view')
  @ApiOperation({ summary: 'Direct reports of this user (one level)' })
  getDirectReports(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getDirectReports(org.id, id);
  }

  @Get('users/:id/all-reports')
  @Permissions('users.view')
  @ApiOperation({
    summary: 'All transitive reports (full subtree, flat depth-annotated list)',
  })
  getAllReports(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getAllReports(org.id, id);
  }

  // ─── Writes ─────────────────────────────────────────────────

  @Post('users/:id/set-manager')
  @Permissions('users.edit')
  @ApiOperation({ summary: 'Attach this user under a manager' })
  setManager(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: SetManagerDto,
  ) {
    return this.service.setManager(org.id, id, dto.managerId);
  }

  @Post('users/:id/unset-manager')
  @Permissions('users.edit')
  @ApiOperation({ summary: 'Detach this user from their manager' })
  unsetManager(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.setManager(org.id, id, null);
  }

  // ─── Self — debug / frontend helper ─────────────────────────
  //
  // Returns the set of user ids whose owned records the CURRENT
  // user can see, plus a flag for each scope level so the frontend
  // can choose to render "Team view" / "Whole hierarchy" filters
  // without re-deriving the rules.

  @Get('me/visibility-scope')
  @Permissions('users.view')
  @ApiOperation({
    summary:
      "Current user's record visibility scope (which owners' records they can see)",
  })
  async myVisibilityScope(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
  ) {
    const permissions: Record<string, Record<string, boolean>> =
      user?.role?.permissions ?? {};

    const hasPerm = (key: string): boolean => {
      const parts = key.split('.');
      const action = parts.pop()!;
      const resource = parts.join('.');
      return permissions?.[resource]?.[action] === true;
    };

    const seesAll = hasPerm('records.sharing.all') || user?.isAdmin === true;
    const seesHierarchy = hasPerm('records.sharing.hierarchy');
    const seesTeam = hasPerm('records.sharing.team');

    const visibleIds = seesAll
      ? null // null = "no filter, sees everything"
      : [
          ...(await this.service.getVisibleUserIds(org.id, user.id, {
            includeReports: seesTeam,
            includeDescendants: seesHierarchy,
          })),
        ];

    return {
      userId: user.id,
      seesAll,
      seesHierarchy,
      seesTeam,
      visibleUserIds: visibleIds,
    };
  }
}
