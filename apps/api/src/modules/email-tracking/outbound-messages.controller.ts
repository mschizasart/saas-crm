import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../database/prisma.service';

const ALLOWED_ROUTED_TO = [
  'lead',
  'client',
  'invoice',
  'estimate',
  'ticket',
  'proposal',
  'statement',
];

/**
 * Auth'd "Sent emails" panel API. Returns the OutboundMessage rows for a
 * given record (invoice/estimate/proposal/etc.) including open and click
 * counters. The tracking pixel and click redirect endpoints live in
 * email-tracking.controller.ts and are public.
 */
@ApiTags('Outbound Messages')
@Controller({ version: '1', path: 'outbound-messages' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class OutboundMessagesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  // tickets.view is the closest existing permission — same convention
  // used by the inbox controller (see inbox.controller.ts header note).
  @Permissions('tickets.view')
  @ApiOperation({
    summary:
      'List sent emails for a given routedTo / routedToId record (invoice, estimate, …)',
  })
  async list(
    @CurrentOrg() org: any,
    @Query('routedTo') routedTo?: string,
    @Query('routedToId') routedToId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!routedTo || !ALLOWED_ROUTED_TO.includes(routedTo)) {
      throw new BadRequestException('Invalid routedTo');
    }
    if (!routedToId) {
      throw new BadRequestException('routedToId is required');
    }
    const take = Math.min(100, Math.max(1, Number(limit) || 50));

    return this.prisma.withOrganization(org.id, async (tx: any) => {
      return tx.outboundMessage.findMany({
        where: { organizationId: org.id, routedTo, routedToId },
        orderBy: { sentAt: 'desc' },
        take,
        select: {
          id: true,
          subject: true,
          recipientEmail: true,
          sentAt: true,
          openedAt: true,
          openCount: true,
          lastOpenedAt: true,
          clickedAt: true,
          clickCount: true,
          lastClickedAt: true,
          clickedUrls: true,
          messageId: true,
        },
      });
    });
  }
}
