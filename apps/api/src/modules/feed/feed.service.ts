import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import {
  CreatePostDto,
  FeedEntityType,
  ListPostsQueryDto,
  MyMentionsQueryDto,
  UpdatePostDto,
} from './feed.dto';

/**
 * Chatter-style internal feed for every record (Wave G3).
 *
 * Every method is org-scoped via `prisma.withOrganization(orgId, …)` —
 * the service layer is the only tenant boundary (no Postgres RLS).
 *
 * Defense-in-depth: every `update` / `delete` `where` clause carries
 * `organizationId: orgId` in addition to the row id, so a forged id
 * from another tenant simply finds nothing.
 *
 * Cross-tenant entity guard: `create()` re-resolves the polymorphic
 * `(entityType, entityId)` against the matching table for the caller's
 * org. Without this, tenant A could attach posts to tenant B's rows.
 *
 * Mention notifications are emitted AFTER the post+mentions transaction
 * commits, so a rolled-back create can never produce a ghost
 * notification in someone's inbox.
 */
@Injectable()
export class FeedService {
  private readonly log = new Logger(FeedService.name);

  // Sliding window during which an author can edit their own post.
  // Five minutes matches Salesforce Chatter / Slack semantics. Enforced
  // server-side — the UI just hides the button.
  private static readonly EDIT_WINDOW_MS = 5 * 60 * 1000;

  // Listing safety cap. The DTO already enforces this; this constant
  // is for the mention inbox where we re-cap defensively.
  private static readonly MAX_PAGE_SIZE = 100;

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  // ─── List + find ─────────────────────────────────────────────

  /**
   * Paged list of TOP-LEVEL posts for an entity, newest first. Each
   * post is returned with its (non-deleted) replies and mentions
   * already hydrated, so the UI can render the whole thread without
   * a follow-up round trip.
   */
  async list(orgId: string, query: ListPostsQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(
      query.limit && query.limit > 0 ? query.limit : 25,
      FeedService.MAX_PAGE_SIZE,
    );
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where = {
        organizationId: orgId,
        entityType: query.entityType,
        entityId: query.entityId,
        parentPostId: null,
        deletedAt: null,
      };

      const [data, total] = await Promise.all([
        tx.feedPost.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            mentions: true,
            replies: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
              include: { mentions: true },
            },
          },
        }),
        tx.feedPost.count({ where }),
      ]);

      // Hydrate author + mentioned-user details in a SECOND pass. We
      // don't model User as a Prisma relation on FeedPost (kept
      // scalar-only to avoid touching the User model — same pattern as
      // TerritoryMember.userId), so we resolve the ids ourselves.
      const userIds = new Set<string>();
      for (const post of data) {
        if (post.authorId) userIds.add(post.authorId);
        for (const m of post.mentions) userIds.add(m.mentionedUserId);
        for (const r of post.replies) {
          if (r.authorId) userIds.add(r.authorId);
          for (const m of r.mentions) userIds.add(m.mentionedUserId);
        }
      }
      const users =
        userIds.size === 0
          ? []
          : await tx.user.findMany({
              where: { id: { in: [...userIds] }, organizationId: orgId },
              select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
            });
      const userMap = new Map(users.map((u) => [u.id, u]));

      const enrichPost = (p: any) => ({
        ...p,
        author: p.authorId ? userMap.get(p.authorId) ?? null : null,
        mentions: p.mentions.map((m: any) => ({
          ...m,
          mentionedUser: userMap.get(m.mentionedUserId) ?? null,
        })),
      });

      const enriched = data.map((p) => ({
        ...enrichPost(p),
        replies: p.replies.map(enrichPost),
      }));

      return {
        data: enriched,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async findOne(orgId: string, postId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const post = await tx.feedPost.findFirst({
        where: { id: postId, organizationId: orgId },
        include: {
          mentions: true,
          replies: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            include: { mentions: true },
          },
        },
      });
      if (!post) throw new NotFoundException('Post not found');

      const userIds = new Set<string>();
      if (post.authorId) userIds.add(post.authorId);
      for (const m of post.mentions) userIds.add(m.mentionedUserId);
      for (const r of post.replies) {
        if (r.authorId) userIds.add(r.authorId);
        for (const m of r.mentions) userIds.add(m.mentionedUserId);
      }
      const users =
        userIds.size === 0
          ? []
          : await tx.user.findMany({
              where: { id: { in: [...userIds] }, organizationId: orgId },
              select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
            });
      const userMap = new Map(users.map((u) => [u.id, u]));

      const enrich = (p: any) => ({
        ...p,
        author: p.authorId ? userMap.get(p.authorId) ?? null : null,
        mentions: p.mentions.map((m: any) => ({
          ...m,
          mentionedUser: userMap.get(m.mentionedUserId) ?? null,
        })),
      });

      return {
        ...enrich(post),
        replies: post.replies.map(enrich),
      };
    });
  }

  // ─── Create ──────────────────────────────────────────────────

  async create(orgId: string, userId: string, dto: CreatePostDto) {
    // 1. (Cross-tenant entity guard runs INSIDE the transaction below
    //    to close the TOCTOU window — if the entity were hard-deleted
    //    between guard and insert, the post would be orphaned.)

    // 2. If this is a reply, the parent MUST live in the same org AND
    //    point at the same entity — no cross-thread or cross-record
    //    replies.
    if (dto.parentPostId) {
      const parent = await this.prisma.feedPost.findFirst({
        where: { id: dto.parentPostId, organizationId: orgId },
        select: { id: true, entityType: true, entityId: true, parentPostId: true },
      });
      if (!parent) {
        throw new BadRequestException('Parent post not found for this organization');
      }
      if (parent.entityType !== dto.entityType || parent.entityId !== dto.entityId) {
        throw new BadRequestException(
          'Parent post belongs to a different entity — cross-thread replies are not allowed',
        );
      }
      // Cap thread depth at 1. The UI only renders one level, so
      // allowing replies-to-replies would produce orphan-looking posts
      // in the tree. Clients must attach all replies to the top-level
      // post.
      if (parent.parentPostId !== null) {
        throw new BadRequestException(
          'Cannot reply to a reply — only top-level posts accept replies',
        );
      }
    }

    // 3. De-dupe and tenant-validate the mention list. The DB UNIQUE
    //    on (postId, mentionedUserId) is the belt-and-braces backstop,
    //    but de-duping here keeps the count check honest.
    const mentionedIds = [
      ...new Set(dto.mentionedUserIds ?? []),
    ].filter((id) => id !== userId); // author can't mention themselves
    if (mentionedIds.length > 0) {
      const orgUsers = await this.prisma.user.findMany({
        where: { id: { in: mentionedIds }, organizationId: orgId },
        select: { id: true },
      });
      if (orgUsers.length !== mentionedIds.length) {
        throw new BadRequestException(
          'One or more mentioned users do not belong to this organization',
        );
      }
    }

    // 4. Atomic write: entity-in-org guard + post insert + every
    //    mention row commit together. The entity guard runs INSIDE the
    //    transaction so the entity can't be hard-deleted between the
    //    guard and the post insert (TOCTOU). If anything blows up the
    //    whole thing rolls back and no notification is fired (we emit
    //    AFTER tx).
    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertEntityInOrg(tx, orgId, dto.entityType, dto.entityId);

      const post = await tx.feedPost.create({
        data: {
          organizationId: orgId,
          entityType: dto.entityType,
          entityId: dto.entityId,
          authorId: userId,
          body: dto.body,
          parentPostId: dto.parentPostId ?? null,
        },
      });

      if (mentionedIds.length > 0) {
        await tx.feedMention.createMany({
          data: mentionedIds.map((mid) => ({
            organizationId: orgId,
            postId: post.id,
            mentionedUserId: mid,
          })),
          skipDuplicates: true,
        });
      }

      return post;
    });

    // 5. AFTER the transaction commits — fan out one event per
    //    mentioned user. Listeners (notifications, push, etc.) consume
    //    these. Emitting inside the tx would risk ghost notifications
    //    if the tx later rolled back.
    for (const mid of mentionedIds) {
      this.events.emit('feed.mention.created', {
        orgId,
        postId: created.id,
        mentionedUserId: mid,
        authorId: userId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        bodyPreview: dto.body.slice(0, 200),
      });
    }

    return this.findOne(orgId, created.id);
  }

  // ─── Update ──────────────────────────────────────────────────

  /**
   * Edit a post body. Author-only, within a 5-minute window. The
   * window is enforced server-side — the UI hides the button but a
   * direct API call past the window still 403s.
   */
  async update(orgId: string, userId: string, postId: string, dto: UpdatePostDto) {
    const existing = await this.prisma.feedPost.findFirst({
      where: { id: postId, organizationId: orgId },
      select: { id: true, authorId: true, createdAt: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt) throw new NotFoundException('Post not found');
    if (existing.authorId !== userId) {
      throw new ForbiddenException('You can only edit your own posts');
    }
    if (Date.now() - existing.createdAt.getTime() > FeedService.EDIT_WINDOW_MS) {
      throw new ForbiddenException('Edit window has passed');
    }

    // Defense-in-depth — the where clause carries org + authorId in
    // addition to id so even a TOCTOU race can't escape the tenant.
    await this.prisma.feedPost.update({
      where: { id: postId, organizationId: orgId, authorId: userId },
      data: { body: dto.body },
    });

    return this.findOne(orgId, postId);
  }

  // ─── Soft delete ─────────────────────────────────────────────

  /**
   * Soft-delete by setting `deletedAt`. Hard delete would cascade-kill
   * the replies thanks to the self-FK ON DELETE CASCADE, which would
   * orphan everyone's threaded reading. Soft delete preserves the
   * thread; the UI renders "[deleted]" placeholders.
   *
   * Author can always delete their own post. A moderator (anyone whose
   * effective `feed.moderate` permission resolves to `true`) can delete
   * anyone's post.
   *
   * Effective-permission resolution mirrors `RbacGuard.effectiveHas`:
   *   1. `user.isAdmin` always allows.
   *   2. `UserPermissionOverride` row for this user wins if present
   *      (grant=true → allow, grant=false → deny).
   *   3. Otherwise fall back to `user.role.permissions.feed.moderate`.
   *
   * Keeping the check here (rather than asking the controller to
   * pre-compute a `canModerate` flag) means a future caller can't
   * accidentally bypass overrides by passing the wrong flag.
   */
  async softDelete(orgId: string, userId: string, postId: string) {
    const existing = await this.prisma.feedPost.findFirst({
      where: { id: postId, organizationId: orgId },
      select: { id: true, authorId: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt) throw new NotFoundException('Post not found');

    // Author can always delete their own post — skip the override lookup.
    if (existing.authorId !== userId) {
      const allowed = await this.userCanModerateFeed(userId);
      if (!allowed) {
        throw new ForbiddenException('You can only delete your own posts');
      }
    }

    await this.prisma.feedPost.update({
      where: { id: postId, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }

  /**
   * Resolve `feed.moderate` for `userId` using the same precedence the
   * RbacGuard uses: super-admin > per-user override > role permission.
   *
   * Wrapped in try/catch for the override read so a pre-migration env
   * (missing `user_permission_overrides` table) silently falls back to
   * role-only behavior — matches RbacGuard.
   */
  private async userCanModerateFeed(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isAdmin: true,
        role: { select: { permissions: true } },
      },
    });
    if (!user) return false;
    if (user.isAdmin === true) return true;

    let override: { grant: boolean } | null = null;
    try {
      override = await (this.prisma as any).userPermissionOverride.findFirst({
        where: { userId, permission: 'feed.moderate' },
        select: { grant: true },
      });
    } catch {
      override = null;
    }
    if (override) return override.grant === true;

    const perms = (user.role?.permissions ?? {}) as Record<
      string,
      Record<string, boolean>
    >;
    return perms?.feed?.moderate === true;
  }

  // ─── My Mentions inbox ───────────────────────────────────────

  /**
   * Recent mentions for the logged-in user. Used by the topbar badge
   * and the dedicated /feed/mentions page. Deleted posts are filtered
   * out — there's no useful "you were mentioned in a deleted post"
   * affordance.
   */
  async getMyRecentMentions(orgId: string, userId: string, query: MyMentionsQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(
      query.limit && query.limit > 0 ? query.limit : 25,
      FeedService.MAX_PAGE_SIZE,
    );
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where = {
        organizationId: orgId,
        mentionedUserId: userId,
        post: { deletedAt: null },
      };

      const [rows, total] = await Promise.all([
        tx.feedMention.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            post: {
              select: {
                id: true,
                body: true,
                authorId: true,
                entityType: true,
                entityId: true,
                createdAt: true,
                parentPostId: true,
              },
            },
          },
        }),
        tx.feedMention.count({ where }),
      ]);

      // Resolve author names in one round trip.
      const authorIds = [
        ...new Set(rows.map((r) => r.post.authorId).filter(Boolean) as string[]),
      ];
      const authors =
        authorIds.length === 0
          ? []
          : await tx.user.findMany({
              where: { id: { in: authorIds }, organizationId: orgId },
              select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
            });
      const authorMap = new Map(authors.map((u) => [u.id, u]));

      const data = rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        notifiedAt: r.notifiedAt,
        post: {
          id: r.post.id,
          bodyPreview: r.post.body.slice(0, 200),
          entityType: r.post.entityType,
          entityId: r.post.entityId,
          parentPostId: r.post.parentPostId,
          createdAt: r.post.createdAt,
          author: r.post.authorId ? authorMap.get(r.post.authorId) ?? null : null,
        },
      }));

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── Internals ───────────────────────────────────────────────

  /**
   * Confirm the polymorphic (entityType, entityId) really points at a
   * row owned by this org. Without this, a forged entityId from
   * another tenant would get a feed thread anchored to a row the
   * caller can't actually see.
   *
   * Takes a `tx` client so it runs inside the same `$transaction` as
   * the subsequent post insert — closes the TOCTOU window where the
   * entity could be hard-deleted between the guard and the write.
   */
  private async assertEntityInOrg(
    tx: any,
    orgId: string,
    entityType: FeedEntityType,
    entityId: string,
  ): Promise<void> {
    let exists: { id: string } | null = null;
    switch (entityType) {
      case 'client':
        exists = await tx.client.findFirst({
          where: { id: entityId, organizationId: orgId },
          select: { id: true },
        });
        break;
      case 'lead':
        exists = await tx.lead.findFirst({
          where: { id: entityId, organizationId: orgId },
          select: { id: true },
        });
        break;
      case 'opportunity':
        exists = await tx.opportunity.findFirst({
          where: { id: entityId, organizationId: orgId },
          select: { id: true },
        });
        break;
      case 'ticket':
        exists = await tx.ticket.findFirst({
          where: { id: entityId, organizationId: orgId },
          select: { id: true },
        });
        break;
      default:
        // The DTO @IsIn check should make this unreachable.
        throw new BadRequestException(`Unsupported entityType: ${entityType}`);
    }
    if (!exists) {
      throw new NotFoundException(
        `${entityType} ${entityId} not found for this organization`,
      );
    }
  }
}
