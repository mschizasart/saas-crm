import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

interface FeedMentionCreatedEvent {
  orgId: string;
  postId: string;
  mentionedUserId: string;
  authorId: string;
  entityType: 'client' | 'lead' | 'opportunity' | 'ticket';
  entityId: string;
  bodyPreview: string;
}

/**
 * Turns a `feed.mention.created` event into an in-app notification
 * (and best-effort web push, via NotificationsService's existing fan
 * out). Decoupled from the create path on purpose — a slow push
 * provider won't slow down the user posting.
 *
 * NotificationsService.create() schema (Wave A):
 *   create(userId, orgId, { type, title, body, link })
 *
 * `link` is a string path. We deep-link straight to the source record
 * with the post id as a hash so the feed component can scroll to it.
 *
 * The mention row's `notifiedAt` is stamped after a successful
 * delivery, so ops can re-fire missed notifications by scanning rows
 * where it's still null.
 */
@Injectable()
export class FeedNotificationListener {
  private readonly log = new Logger(FeedNotificationListener.name);

  constructor(
    private notifications: NotificationsService,
    private prisma: PrismaService,
  ) {}

  @OnEvent('feed.mention.created')
  async onMentionCreated(payload: FeedMentionCreatedEvent) {
    if (!payload?.mentionedUserId || !payload?.orgId || !payload?.postId) return;

    // Resolve the author's display name for a friendlier notification
    // title. Best-effort — if the lookup fails the title is still
    // useful as a generic "You were mentioned".
    let authorName = 'Someone';
    try {
      const author = await this.prisma.user.findFirst({
        where: { id: payload.authorId, organizationId: payload.orgId },
        select: { firstName: true, lastName: true, email: true },
      });
      if (author) {
        authorName = `${author.firstName ?? ''} ${author.lastName ?? ''}`.trim() || author.email || 'Someone';
      }
    } catch (err) {
      this.log.warn(`Failed to resolve author name: ${(err as Error).message}`);
    }

    const link = this.linkFor(payload.entityType, payload.entityId, payload.postId);

    try {
      await this.notifications.create(payload.mentionedUserId, payload.orgId, {
        type: 'feed.mention',
        title: `${authorName} mentioned you`,
        body: payload.bodyPreview,
        link,
      });

      // Stamp notifiedAt so an ops "re-fire missed" sweep skips this
      // row. Best-effort — a stamping failure doesn't undo the
      // notification that was already delivered.
      await this.prisma.feedMention.updateMany({
        where: {
          postId: payload.postId,
          mentionedUserId: payload.mentionedUserId,
          organizationId: payload.orgId,
        },
        data: { notifiedAt: new Date() },
      }).catch((err) => {
        this.log.warn(
          `feedMention.notifiedAt stamp failed for post=${payload.postId} user=${payload.mentionedUserId}: ${err?.message ?? err}`,
        );
      });
    } catch (err) {
      // Swallow — a notification delivery failure must not crash the
      // event bus. The mention row stays unstamped, so ops can replay.
      this.log.error(
        `Failed to notify user=${payload.mentionedUserId} of mention on post=${payload.postId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Build the in-app deep link for a mention. Includes a `#post-<id>`
   * hash so the feed component can scroll the relevant post into view.
   */
  private linkFor(
    entityType: FeedMentionCreatedEvent['entityType'],
    entityId: string,
    postId: string,
  ): string {
    switch (entityType) {
      case 'client':
        return `/clients/${entityId}#post-${postId}`;
      case 'lead':
        return `/leads/${entityId}#post-${postId}`;
      case 'opportunity':
        return `/opportunities/${entityId}#post-${postId}`;
      case 'ticket':
        return `/tickets/${entityId}#post-${postId}`;
      default:
        return `/feed/mentions`;
    }
  }
}
