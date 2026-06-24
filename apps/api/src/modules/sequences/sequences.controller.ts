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
import {
  SequencesService,
  CreateSequenceDto,
  UpdateSequenceDto,
  CreateStepDto,
  UpdateStepDto,
  ReorderStepsDto,
  EnrollDto,
} from './sequences.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

/**
 * Sequences / cadences — multi-step automated follow-up flows.
 *
 * Gated by the granular `sequences.*` permission group (view / create / edit
 * / delete / execute). Admin/owner tiers bypass RBAC via RbacGuard.
 */
@ApiTags('Sequences')
@Controller({ version: '1', path: 'sequences' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class SequencesController {
  constructor(private readonly service: SequencesService) {}

  @Get()
  @Permissions('sequences.view')
  @ApiOperation({ summary: 'List sequences with enrollment counts' })
  findAll(@CurrentOrg() org: any) {
    return this.service.findAll(org.id);
  }

  @Post()
  @Permissions('sequences.create')
  @ApiOperation({ summary: 'Create a sequence (draft)' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateSequenceDto,
  ) {
    return this.service.create(org.id, dto, user?.id);
  }

  @Get(':id')
  @Permissions('sequences.view')
  @ApiOperation({ summary: 'Get a sequence with its ordered steps' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Put(':id')
  @Permissions('sequences.edit')
  @ApiOperation({ summary: 'Update a sequence (name / description)' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateSequenceDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('sequences.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft sequence' })
  async remove(@CurrentOrg() org: any, @Param('id') id: string) {
    await this.service.remove(org.id, id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Permissions('sequences.edit')
  @ApiOperation({ summary: 'Activate a sequence (validates steps)' })
  activate(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.activate(org.id, id);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @Permissions('sequences.edit')
  @ApiOperation({ summary: 'Pause a sequence' })
  pause(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.pause(org.id, id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @Permissions('sequences.edit')
  @ApiOperation({ summary: 'Resume a paused sequence' })
  resume(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.resume(org.id, id);
  }

  // ─── Steps ─────────────────────────────────────────────────────────────

  @Post(':id/steps')
  @Permissions('sequences.edit')
  @ApiOperation({ summary: 'Add a step to a sequence' })
  addStep(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: CreateStepDto,
  ) {
    return this.service.addStep(org.id, id, dto);
  }

  @Put(':id/steps/reorder')
  @HttpCode(HttpStatus.OK)
  @Permissions('sequences.edit')
  @ApiOperation({ summary: 'Reorder a sequence\'s steps' })
  reorderSteps(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: ReorderStepsDto,
  ) {
    return this.service.reorderSteps(org.id, id, dto.orderedStepIds);
  }

  @Put(':id/steps/:stepId')
  @Permissions('sequences.edit')
  @ApiOperation({ summary: 'Update a step' })
  updateStep(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateStepDto,
  ) {
    return this.service.updateStep(org.id, id, stepId, dto);
  }

  @Delete(':id/steps/:stepId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('sequences.edit')
  @ApiOperation({ summary: 'Delete a step' })
  async removeStep(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
  ) {
    await this.service.removeStep(org.id, id, stepId);
  }

  // ─── Enrollment ────────────────────────────────────────────────────────

  @Post(':id/enroll')
  @HttpCode(HttpStatus.OK)
  @Permissions('sequences.execute')
  @ApiOperation({ summary: 'Enroll leads/clients into an active sequence' })
  enroll(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: EnrollDto,
  ) {
    return this.service.enroll(org.id, id, dto.recipients, user?.id);
  }

  @Get(':id/enrollments')
  @Permissions('sequences.view')
  @ApiOperation({ summary: 'List a sequence\'s enrollments' })
  listEnrollments(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.listEnrollments(org.id, id);
  }

  @Post('enrollments/:enrollmentId/unenroll')
  @HttpCode(HttpStatus.OK)
  @Permissions('sequences.execute')
  @ApiOperation({ summary: 'Unenroll a recipient from a sequence' })
  unenroll(
    @CurrentOrg() org: any,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.service.unenroll(org.id, enrollmentId);
  }

  @Get(':id/stats')
  @Permissions('sequences.view')
  @ApiOperation({ summary: 'Enrollment + email-sent aggregates' })
  stats(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.stats(org.id, id);
  }
}
