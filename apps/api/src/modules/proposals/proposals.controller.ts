import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProposalsService, CreateProposalDto } from './proposals.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  Permissions,
  Public,
} from '../../common/decorators/permissions.decorator';
import { PdfService } from '../pdf/pdf.service';
import { renderProposalHtml } from '../pdf/templates/proposal.template';
import { ActivityLogService } from '../activity-log/activity-log.service';

@ApiTags('Proposals')
@Controller({ version: '1', path: 'proposals' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ProposalsController {
  constructor(
    private service: ProposalsService,
    private pdfService: PdfService,
    private activityLog: ActivityLogService,
  ) {}

  // ─── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get proposal status counts' })
  getStats(@CurrentOrg() org: any) {
    return this.service.getStats(org.id);
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  @Get()
  @Permissions('clients.view')
  @ApiOperation({ summary: 'List proposals (paginated, filterable)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      status,
      assignedTo,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // ─── Download PDF ──────────────────────────────────────────────────────────

  @Get(':id/pdf')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Download proposal as PDF' })
  async downloadPdf(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Res() res: any,
  ) {
    const proposal = await this.service.findOne(org.id, id);
    const html = renderProposalHtml(proposal, org);
    const pdf = await this.pdfService.generatePdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="proposal-${(proposal as any).id}.pdf"`,
    );
    res.end(pdf);
  }

  // ─── View by hash (public) ────────────────────────────────────────────────

  @Get('view/:hash')
  @Public()
  @ApiOperation({ summary: 'Get proposal by hash (client-facing, public)' })
  getByHash(@Param('hash') hash: string) {
    return this.service.getByHash(hash);
  }

  // ─── Single ────────────────────────────────────────────────────────────────

  @Get(':id')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get a single proposal with full details' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  @Post()
  @Permissions('clients.create')
  @ApiOperation({ summary: 'Create a new proposal' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateProposalDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  @Patch(':id')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Update a draft or revising proposal' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateProposalDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  // ─── Update Status (generic, used by pipeline/kanban) ─────────────────────

  @Patch(':id/status')
  @Permissions('proposals.edit')
  @ApiOperation({
    summary:
      'Generic status change — used by the kanban pipeline. Accepts both `revised` and `revising`; persists the canonical value used by the service (`revising`). No side-effects.',
  })
  async updateStatus(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    const updated = await this.service.updateStatus(
      org.id,
      id,
      body.status,
      user?.id,
    );
    try {
      await this.activityLog.log(org.id, {
        userId: user?.id,
        action: 'proposal.status_changed',
        entityType: 'proposal',
        entityId: id,
        description: `Proposal ${(updated as any).subject ?? id} status → ${(updated as any).status}`,
        metadata: { newStatus: (updated as any).status },
      });
    } catch {
      // non-fatal
    }
    return updated;
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @Permissions('clients.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft proposal' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  // ─── Send ──────────────────────────────────────────────────────────────────

  @Post(':id/send')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Send a proposal to the client' })
  send(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.send(org.id, id);
  }

  // ─── Mark Open (public) ───────────────────────────────────────────────────

  @Post('view/:hash/open')
  @Public()
  @ApiOperation({ summary: 'Mark a proposal as opened (client visits link)' })
  markOpen(@Param('hash') hash: string) {
    return this.service.markOpen(hash);
  }

  // ─── Accept (public) ──────────────────────────────────────────────────────

  @Post('view/:hash/accept')
  @Public()
  @ApiOperation({ summary: 'Client accepts the proposal' })
  accept(@Param('hash') hash: string) {
    return this.service.accept(hash);
  }

  // ─── Decline (public) ─────────────────────────────────────────────────────

  @Post('view/:hash/decline')
  @Public()
  @ApiOperation({ summary: 'Client declines the proposal' })
  decline(@Param('hash') hash: string) {
    return this.service.decline(hash);
  }

  // ─── Add Comment (public / client) ────────────────────────────────────────

  @Post('view/:hash/comments')
  @Public()
  @ApiOperation({ summary: 'Client adds a comment to a proposal' })
  async addCommentPublic(
    @Param('hash') hash: string,
    @Body() body: { content: string; addedBy: string },
  ) {
    const proposal = await this.service.getByHash(hash);
    return this.service.addComment(
      (proposal as any).id,
      body.content,
      false,
      body.addedBy,
    );
  }

  // ─── Add Comment (staff) ──────────────────────────────────────────────────

  @Post(':id/comments')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Staff adds a comment to a proposal' })
  addComment(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    return this.service.addComment(id, body.content, true, user.id, org.id);
  }
}
