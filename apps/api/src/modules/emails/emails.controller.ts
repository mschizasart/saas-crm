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
import { EmailsService } from './emails.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('Emails')
@Controller({ version: '1', path: 'emails' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class EmailsController {
  constructor(
    private service: EmailsService,
    private prisma: PrismaService,
  ) {}

  // ─── Email Templates CRUD ────────────────────────────────────────────────

  @Get('templates')
  @Permissions('settings.view')
  @ApiOperation({ summary: 'List all email templates' })
  async listTemplates(
    @CurrentOrg() org: any,
    @Query('type') type?: string,
  ) {
    return this.prisma.withOrganization(org.id, async (tx) => {
      const where: any = { organizationId: org.id };
      if (type) where.type = type;
      return tx.emailTemplate.findMany({
        where,
        orderBy: [{ type: 'asc' }, { slug: 'asc' }],
      });
    });
  }

  @Get('templates/:id')
  @Permissions('settings.view')
  @ApiOperation({ summary: 'Get a single email template' })
  async getTemplate(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.prisma.withOrganization(org.id, async (tx) => {
      const tpl = await tx.emailTemplate.findFirst({
        where: { id, organizationId: org.id },
      });
      if (!tpl) throw new Error('Template not found');
      return tpl;
    });
  }

  @Post('templates')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Create an email template' })
  async createTemplate(
    @CurrentOrg() org: any,
    @Body() body: { slug: string; subject: string; body: string; type?: string },
  ) {
    return this.prisma.withOrganization(org.id, async (tx) => {
      return tx.emailTemplate.create({
        data: {
          organizationId: org.id,
          slug: body.slug,
          subject: body.subject,
          body: body.body,
          type: body.type ?? null,
        },
      });
    });
  }

  @Patch('templates/:id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Update an email template' })
  async updateTemplate(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { subject?: string; body?: string; active?: boolean },
  ) {
    return this.prisma.withOrganization(org.id, async (tx) => {
      return tx.emailTemplate.update({
        where: { id },
        data: {
          ...(body.subject !== undefined && { subject: body.subject }),
          ...(body.body !== undefined && { body: body.body }),
          ...(body.active !== undefined && { active: body.active }),
        },
      });
    });
  }

  @Delete('templates/:id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an email template' })
  async deleteTemplate(@CurrentOrg() org: any, @Param('id') id: string) {
    await this.prisma.withOrganization(org.id, async (tx) => {
      await tx.emailTemplate.delete({ where: { id } });
    });
  }

  // ─── Send Test Email ──────────────────────────────────────────────────────

  @Post('test')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Send a test email to verify SMTP settings' })
  async sendTestEmail(
    @CurrentOrg() org: any,
    @Body() body: { to: string },
  ) {
    await this.service.send({
      to: body.to,
      subject: 'CRM Test Email',
      html: '<p>This is a test email from your CRM to verify SMTP settings are working correctly.</p>',
    });
    return { success: true, message: `Test email sent to ${body.to}` };
  }
}
