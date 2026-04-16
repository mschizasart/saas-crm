import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class NewsfeedService {
  constructor(private prisma: PrismaService) {}

  async findAll(orgId: string, query: { page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    return this.prisma.withOrganization(orgId, async (tx) => {
      const [data, total] = await Promise.all([
        (tx as any).newsfeedPost.findMany({
          where: { organizationId: orgId },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          },
        }),
        (tx as any).newsfeedPost.count({ where: { organizationId: orgId } }),
      ]);
      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async create(orgId: string, userId: string, content: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).newsfeedPost.create({
        data: { organizationId: orgId, userId, content },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
      });
    });
  }

  async delete(orgId: string, id: string, userId: string, isAdmin: boolean) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const post = await (tx as any).newsfeedPost.findFirst({ where: { id, organizationId: orgId } });
      if (!post) throw new NotFoundException();
      if (post.userId !== userId && !isAdmin) throw new ForbiddenException('Only author or admin can delete');
      await (tx as any).newsfeedPost.delete({ where: { id } });
    });
  }

  async like(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).newsfeedPost.update({
        where: { id },
        data: { likes: { increment: 1 } },
      });
    });
  }
}
