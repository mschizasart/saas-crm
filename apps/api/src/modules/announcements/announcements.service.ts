import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface CreateAnnouncementDto {
  title: string;
  message: string;
  showToStaff?: boolean;
  showToClients?: boolean;
  link?: string;
  dismissible?: boolean;
  expiresAt?: string;
}

export type UpdateAnnouncementDto = Partial<CreateAnnouncementDto>;

@Injectable()
export class AnnouncementsService {
  constructor(private prisma: PrismaService) {}

  async findAll(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.announcement.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  async findActive(
    orgId: string,
    audience: 'staff' | 'clients',
    userId: string,
  ) {
    const now = new Date();
    return this.prisma.withOrganization(orgId, async (tx) => {
      const audienceFilter =
        audience === 'staff' ? { showToStaff: true } : { showToClients: true };

      const items = await tx.announcement.findMany({
        where: {
          organizationId: orgId,
          ...audienceFilter,
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          dismissals: { none: { userId } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return items;
    });
  }

  async create(orgId: string, dto: CreateAnnouncementDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.announcement.create({
        data: {
          organizationId: orgId,
          title: dto.title,
          message: dto.message,
          showToStaff: dto.showToStaff ?? true,
          showToClients: dto.showToClients ?? false,
          link: dto.link ?? null,
          dismissible: dto.dismissible ?? true,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });
    });
  }

  async update(orgId: string, id: string, dto: UpdateAnnouncementDto) {
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.announcement.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.message !== undefined && { message: dto.message }),
          ...(dto.showToStaff !== undefined && { showToStaff: dto.showToStaff }),
          ...(dto.showToClients !== undefined && {
            showToClients: dto.showToClients,
          }),
          ...(dto.link !== undefined && { link: dto.link }),
          ...(dto.dismissible !== undefined && { dismissible: dto.dismissible }),
          ...(dto.expiresAt !== undefined && {
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          }),
        },
      });
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const a = await tx.announcement.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!a) throw new NotFoundException('Announcement not found');
      return a;
    });
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.announcement.delete({ where: { id } });
    });
  }

  async dismiss(userId: string, announcementId: string) {
    const prismaAny = this.prisma as any;
    return prismaAny.announcementDismissal.upsert({
      where: {
        announcementId_userId: { announcementId, userId },
      },
      create: { announcementId, userId },
      update: {},
    });
  }
}
