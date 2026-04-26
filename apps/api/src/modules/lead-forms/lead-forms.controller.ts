import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions, Public } from '../../common/decorators/permissions.decorator';
import { LeadFormsService } from './lead-forms.service';
import {
  CreateLeadFormDto,
  SubmitLeadFormDto,
  UpdateLeadFormDto,
} from './dto/lead-form.dto';

@ApiTags('Lead Forms')
@Controller({ version: '1' })
export class LeadFormsController {
  constructor(private service: LeadFormsService) {}

  // ─── Admin (authenticated) ─────────────────────────────────

  // NOTE: The spec called for `@RequirePermission('leads.manage')`. The
  // existing RBAC seed (roles.service.ts) only defines granular
  // leads.{view,create,edit,delete} permissions, so we reuse those to avoid
  // forcing a role-schema migration. Super-admins bypass either way.

  @Get('lead-forms')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @ApiBearerAuth()
  @Permissions('leads.view')
  @ApiOperation({ summary: 'List all lead forms for the current organization' })
  list(@CurrentOrg() org: any) {
    return this.service.list(org.id);
  }

  @Get('lead-forms/:id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @ApiBearerAuth()
  @Permissions('leads.view')
  @ApiOperation({ summary: 'Get a single lead form (admin view)' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post('lead-forms')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @ApiBearerAuth()
  @Permissions('leads.create')
  @ApiOperation({ summary: 'Create a new lead form' })
  create(@CurrentOrg() org: any, @Body() dto: CreateLeadFormDto) {
    return this.service.create(org.id, dto);
  }

  @Put('lead-forms/:id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @ApiBearerAuth()
  @Permissions('leads.edit')
  @ApiOperation({ summary: 'Update an existing lead form' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateLeadFormDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete('lead-forms/:id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @ApiBearerAuth()
  @Permissions('leads.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a lead form' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  // ─── Public (unauthenticated) ──────────────────────────────
  //
  // Route prefix `public/` is recognised by TenantInterceptor as unauthenticated;
  // also marked @Public() so JwtAuthGuard would be skipped if ever attached.

  @Get('public/lead-forms/:orgSlug/:formSlug')
  @Public()
  @ApiOperation({
    summary: 'Fetch a public lead form definition for rendering',
  })
  getPublic(
    @Param('orgSlug') orgSlug: string,
    @Param('formSlug') formSlug: string,
  ) {
    return this.service.getPublic(orgSlug, formSlug);
  }

  @Post('public/lead-forms/:orgSlug/:formSlug/submit')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a public lead form — creates a Lead' })
  submit(
    @Param('orgSlug') orgSlug: string,
    @Param('formSlug') formSlug: string,
    @Body() body: SubmitLeadFormDto,
    @Ip() ip: string,
  ) {
    return this.service.submit(orgSlug, formSlug, body as any, ip ?? null);
  }
}
