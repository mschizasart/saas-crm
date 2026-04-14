import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface CreateArticleDto {
  title: string;
  content?: string;
  groupId?: string;
  active?: boolean;
  order?: number;
}

@Injectable()
export class KnowledgeBaseService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  // ─── Private helpers ───────────────────────────────────────────────────────

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  private generateSuffix(): string {
    return Math.random().toString(36).substring(2, 6);
  }

  private async resolveUniqueSlug(
    orgId: string,
    base: string,
    tx: any,
    excludeId?: string,
  ): Promise<string> {
    let slug = base;
    const where: any = { organizationId: orgId, slug };
    if (excludeId) where.id = { not: excludeId };

    const existing = await tx.knowledgeBaseArticle.findFirst({ where });
    if (!existing) return slug;

    // Append random suffix until unique
    for (let attempts = 0; attempts < 10; attempts++) {
      slug = `${base}-${this.generateSuffix()}`;
      const conflict = await tx.knowledgeBaseArticle.findFirst({
        where: { organizationId: orgId, slug },
      });
      if (!conflict) return slug;
    }

    // Last-resort fallback using timestamp
    return `${base}-${Date.now()}`;
  }

  // ─── Groups ────────────────────────────────────────────────────────────────

  async getGroups(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.knowledgeBaseGroup.findMany({
        where: { organizationId: orgId },
        orderBy: { order: 'asc' },
        include: {
          _count: {
            select: {
              articles: { where: { active: true } },
            },
          },
        },
      });
    });
  }

  async createGroup(
    orgId: string,
    name: string,
    color?: string,
    icon?: string,
  ) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.knowledgeBaseGroup.create({
        data: {
          organizationId: orgId,
          name,
          color: color ?? null,
          icon: icon ?? null,
        },
      });
    });
  }

  async updateGroup(
    orgId: string,
    id: string,
    dto: { name?: string; color?: string; icon?: string; order?: number },
  ) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const group = await tx.knowledgeBaseGroup.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!group) throw new NotFoundException('Group not found');

      return tx.knowledgeBaseGroup.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.color !== undefined && { color: dto.color }),
          ...(dto.icon !== undefined && { icon: dto.icon }),
          ...(dto.order !== undefined && { order: dto.order }),
        },
      });
    });
  }

  async deleteGroup(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const group = await tx.knowledgeBaseGroup.findFirst({
        where: { id, organizationId: orgId },
        include: { _count: { select: { articles: true } } },
      });
      if (!group) throw new NotFoundException('Group not found');

      if ((group._count as any).articles > 0) {
        throw new BadRequestException(
          'Cannot delete a group that still has articles. Move or delete the articles first.',
        );
      }

      await tx.knowledgeBaseGroup.delete({ where: { id } });
    });
  }

  // ─── findAll ───────────────────────────────────────────────────────────────

  async findAll(
    orgId: string,
    query: {
      search?: string;
      groupId?: string;
      active?: boolean;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, groupId, active, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (groupId) where.groupId = groupId;
      if (active !== undefined) where.active = active;
      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { content: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        tx.knowledgeBaseArticle.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
          include: {
            group: { select: { id: true, name: true } },
            creator: { select: { firstName: true, lastName: true } },
          },
        }),
        tx.knowledgeBaseArticle.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── findOne ───────────────────────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const article = await tx.knowledgeBaseArticle.findFirst({
        where: { id, organizationId: orgId },
        include: {
          group: true,
          creator: { select: { firstName: true, lastName: true } },
        },
      });
      if (!article) throw new NotFoundException('Article not found');
      return article;
    });
  }

  // ─── findBySlug (public) ──────────────────────────────────────────────────

  async findBySlug(orgId: string, slug: string) {
    const article = await this.prisma.knowledgeBaseArticle.findFirst({
      where: { organizationId: orgId, slug, active: true },
      include: {
        group: { select: { id: true, name: true, color: true, icon: true } },
      },
    });
    if (!article) throw new NotFoundException('Article not found');

    // Increment view count (fire-and-forget — don't block response)
    this.prisma.knowledgeBaseArticle
      .update({
        where: { id: article.id },
        data: { views: { increment: 1 } },
      })
      .catch(() => {
        // ignore increment errors
      });

    return article;
  }

  // ─── create ────────────────────────────────────────────────────────────────

  async create(orgId: string, dto: CreateArticleDto, createdBy: string) {
    const article = await this.prisma.withOrganization(orgId, async (tx) => {
      const baseSlug = this.generateSlug(dto.title);
      const slug = await this.resolveUniqueSlug(orgId, baseSlug, tx);

      return tx.knowledgeBaseArticle.create({
        data: {
          organizationId: orgId,
          title: dto.title,
          content: dto.content ?? '',
          slug,
          groupId: dto.groupId ?? null,
          active: dto.active ?? true,
          order: dto.order ?? 0,
          createdBy,
        },
        include: {
          group: { select: { id: true, name: true } },
        },
      });
    });

    this.events.emit('kb.article_created', { article, orgId, createdBy });
    return article;
  }

  // ─── update ────────────────────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: Partial<CreateArticleDto>) {
    await this.findOne(orgId, id);

    return this.prisma.withOrganization(orgId, async (tx) => {
      let slug: string | undefined;

      if (dto.title !== undefined) {
        const baseSlug = this.generateSlug(dto.title);
        slug = await this.resolveUniqueSlug(orgId, baseSlug, tx, id);
      }

      return tx.knowledgeBaseArticle.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(slug !== undefined && { slug }),
          ...(dto.content !== undefined && { content: dto.content }),
          ...(dto.groupId !== undefined && { groupId: dto.groupId }),
          ...(dto.active !== undefined && { active: dto.active }),
          ...(dto.order !== undefined && { order: dto.order }),
        },
        include: {
          group: { select: { id: true, name: true } },
        },
      });
    });
  }

  // ─── delete ────────────────────────────────────────────────────────────────

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.knowledgeBaseArticle.delete({ where: { id } });
    });
    this.events.emit('kb.article_deleted', { id, orgId });
  }

  // ─── search (full-text) ───────────────────────────────────────────────────

  async search(orgId: string, query: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      // Use PostgreSQL full-text search with to_tsvector / plainto_tsquery.
      // Returns top 10 active articles, with a ts_headline snippet from content.
      const results: any[] = await tx.$queryRaw`
        SELECT
          a.id,
          a.title,
          a.slug,
          a.active,
          a."groupId",
          a.views,
          a."createdAt",
          ts_headline(
            'english',
            a.content,
            plainto_tsquery('english', ${query}),
            'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
          ) AS snippet
        FROM "KnowledgeBaseArticle" a
        WHERE
          a."organizationId" = ${orgId}
          AND a.active = true
          AND to_tsvector('english', a.title || ' ' || a.content)
              @@ plainto_tsquery('english', ${query})
        ORDER BY
          ts_rank(
            to_tsvector('english', a.title || ' ' || a.content),
            plainto_tsquery('english', ${query})
          ) DESC
        LIMIT 10
      `;

      return results;
    });
  }
}
