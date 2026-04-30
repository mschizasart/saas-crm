import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { InboxRouterService, RoutedTarget } from './router.service';

export interface ListInboxQuery {
  routedTo?: string;
  routedToId?: string;
  search?: string;
  isArchived?: boolean;
  isStarred?: boolean;
  page?: number;
  limit?: number;
}

export interface UpdateInboxDto {
  isRead?: boolean;
  isStarred?: boolean;
  isArchived?: boolean;
  routedTo?: RoutedTarget;
  routedToId?: string | null;
}

const ALLOWED_ROUTED_TO: RoutedTarget[] = [
  'lead',
  'client',
  'invoice',
  'estimate',
  'ticket',
  'unmatched',
];

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: InboxRouterService,
  ) {}

  async list(orgId: string, q: ListInboxQuery) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    const skip = (page - 1) * limit;

    const where: any = { organizationId: orgId };
    if (q.routedTo) {
      if (!ALLOWED_ROUTED_TO.includes(q.routedTo as RoutedTarget)) {
        throw new BadRequestException('Invalid routedTo');
      }
      where.routedTo = q.routedTo;
    }
    if (q.routedToId) where.routedToId = q.routedToId;
    if (typeof q.isArchived === 'boolean') {
      where.isArchived = q.isArchived;
    } else {
      where.isArchived = false;
    }
    if (typeof q.isStarred === 'boolean') where.isStarred = q.isStarred;

    if (q.search && q.search.trim().length > 0) {
      const s = q.search.trim();
      where.OR = [
        { subject: { contains: s, mode: 'insensitive' } },
        { fromEmail: { contains: s, mode: 'insensitive' } },
        { fromName: { contains: s, mode: 'insensitive' } },
        { bodyText: { contains: s, mode: 'insensitive' } },
      ];
    }

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const [total, data] = await Promise.all([
        tx.inboxMessage.count({ where }),
        tx.inboxMessage.findMany({
          where,
          orderBy: { receivedAt: 'desc' },
          skip,
          take: limit,
          select: {
            id: true,
            messageId: true,
            fromEmail: true,
            fromName: true,
            subject: true,
            receivedAt: true,
            attachmentCount: true,
            routedTo: true,
            routedToId: true,
            isRead: true,
            isStarred: true,
            isArchived: true,
          },
        }),
      ]);
      return { data, total, page, limit };
    });
  }

  async findOne(orgId: string, id: string, markRead = false) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const row = await tx.inboxMessage.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!row) throw new NotFoundException('Inbox message not found');

      if (markRead && !row.isRead) {
        return tx.inboxMessage.update({
          where: { id },
          data: { isRead: true },
        });
      }
      return row;
    });
  }

  async update(orgId: string, id: string, dto: UpdateInboxDto) {
    if (dto.routedTo && !ALLOWED_ROUTED_TO.includes(dto.routedTo)) {
      throw new BadRequestException('Invalid routedTo');
    }
    // If routedTo is being changed, validate the target exists.
    if (dto.routedTo) {
      const ok = await this.router.validateTarget(
        orgId,
        dto.routedTo,
        dto.routedToId ?? null,
      );
      if (!ok) {
        throw new BadRequestException(
          'routedTo / routedToId pair does not match a record in this organization',
        );
      }
    }

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const existing = await tx.inboxMessage.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Inbox message not found');

      return tx.inboxMessage.update({
        where: { id },
        data: {
          ...(typeof dto.isRead === 'boolean' ? { isRead: dto.isRead } : {}),
          ...(typeof dto.isStarred === 'boolean'
            ? { isStarred: dto.isStarred }
            : {}),
          ...(typeof dto.isArchived === 'boolean'
            ? { isArchived: dto.isArchived }
            : {}),
          ...(dto.routedTo
            ? {
                routedTo: dto.routedTo,
                routedToId: dto.routedToId ?? null,
              }
            : {}),
        },
      });
    });
  }

  async manualRoute(
    orgId: string,
    id: string,
    routedTo: RoutedTarget,
    routedToId: string | null,
  ) {
    if (!ALLOWED_ROUTED_TO.includes(routedTo)) {
      throw new BadRequestException('Invalid routedTo');
    }
    const ok = await this.router.validateTarget(orgId, routedTo, routedToId);
    if (!ok) {
      throw new BadRequestException(
        'routedTo / routedToId pair does not match a record in this organization',
      );
    }
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const existing = await tx.inboxMessage.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Inbox message not found');
      return tx.inboxMessage.update({
        where: { id },
        data: { routedTo, routedToId },
      });
    });
  }

  /**
   * List of attachments for a given message (filenames + metadata only —
   * v1 does NOT fetch bytes from IMAP, see imap-connector.service.ts).
   */
  async getAttachments(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const row = await tx.inboxMessage.findFirst({
        where: { id, organizationId: orgId },
        select: { attachmentsJson: true, attachmentCount: true },
      });
      if (!row) throw new NotFoundException('Inbox message not found');
      return {
        count: row.attachmentCount,
        items: row.attachmentsJson ?? [],
      };
    });
  }
}
