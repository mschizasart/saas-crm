import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { TerritoryMembersService } from './territory-members.service';
import { AddMemberDto, UpdateMemberDto } from './territories.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

// ─── Territory members controller (Wave G2) ─────────────────────
//
// Nested under `/territories/:id` so the territory id is bound at
// the path level and the service layer can tenant-check it before
// touching the members table.

@ApiTags('Territory members')
@Controller({ version: '1', path: 'territories' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class TerritoryMembersController {
  constructor(private service: TerritoryMembersService) {}

  @Get(':id/members')
  @Permissions('territories.view')
  @ApiOperation({ summary: 'List members of a territory' })
  list(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.list(org.id, id);
  }

  @Post(':id/members')
  @Permissions('territories.configure')
  @ApiOperation({ summary: 'Add a user as member or manager' })
  add(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.service.addMember(org.id, id, dto);
  }

  @Put(':id/members/:userId')
  @Permissions('territories.configure')
  @ApiOperation({ summary: 'Change a member role (member <-> manager)' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.service.updateMember(org.id, id, userId, dto.role);
  }

  @Delete(':id/members/:userId')
  @Permissions('territories.configure')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member from a territory' })
  remove(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.service.removeMember(org.id, id, userId);
  }
}
