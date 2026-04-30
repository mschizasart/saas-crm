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
import {
  Permissions,
  Public,
} from '../../common/decorators/permissions.decorator';
import { EstimateRequestFormsService } from './estimate-request-forms.service';
import {
  CreateEstimateRequestFormDto,
  SubmitEstimateRequestFormDto,
  UpdateEstimateRequestFormDto,
} from './dto/estimate-request-form.dto';

@ApiTags('Estimate Request Forms')
@Controller({ version: '1' })
export class EstimateRequestFormsController {
  constructor(private service: EstimateRequestFormsService) {}

  // ─── Admin (authenticated) ─────────────────────────────────
  //
  // The spec asked for an `estimates.manage` permission. The existing role
  // seed only ships granular `estimates.{view,create,edit,delete}`, so we
  // mirror lead-forms and reuse those (super-admins bypass either way).

  @Get('estimate-request-forms')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @ApiBearerAuth()
  @Permissions('estimates.view')
  @ApiOperation({
    summary: 'List all estimate-request forms for the current organization',
  })
  list(@CurrentOrg() org: any) {
    return this.service.list(org.id);
  }

  @Get('estimate-request-forms/:id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @ApiBearerAuth()
  @Permissions('estimates.view')
  @ApiOperation({ summary: 'Get a single estimate-request form (admin view)' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post('estimate-request-forms')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @ApiBearerAuth()
  @Permissions('estimates.create')
  @ApiOperation({ summary: 'Create a new estimate-request form' })
  create(
    @CurrentOrg() org: any,
    @Body() dto: CreateEstimateRequestFormDto,
  ) {
    return this.service.create(org.id, dto);
  }

  @Put('estimate-request-forms/:id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @ApiBearerAuth()
  @Permissions('estimates.edit')
  @ApiOperation({ summary: 'Update an existing estimate-request form' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateEstimateRequestFormDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete('estimate-request-forms/:id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @ApiBearerAuth()
  @Permissions('estimates.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an estimate-request form' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  // ─── Public (unauthenticated) ──────────────────────────────
  //
  // Route prefix `public/` is recognised by TenantInterceptor as
  // unauthenticated; also marked @Public() so JwtAuthGuard would be skipped
  // if it were ever attached.

  @Get('public/estimate-request-forms/:orgSlug/:formSlug')
  @Public()
  @ApiOperation({
    summary: 'Fetch a public estimate-request form definition for rendering',
  })
  getPublic(
    @Param('orgSlug') orgSlug: string,
    @Param('formSlug') formSlug: string,
  ) {
    return this.service.getPublic(orgSlug, formSlug);
  }

  @Post('public/estimate-request-forms/:orgSlug/:formSlug/submit')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Submit a public estimate-request form — creates a draft Estimate',
  })
  submit(
    @Param('orgSlug') orgSlug: string,
    @Param('formSlug') formSlug: string,
    @Body() body: SubmitEstimateRequestFormDto,
    @Ip() ip: string,
  ) {
    return this.service.submit(orgSlug, formSlug, body as any, ip ?? null);
  }
}
