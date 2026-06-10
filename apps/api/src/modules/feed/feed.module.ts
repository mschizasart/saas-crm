import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { FeedNotificationListener } from './feed-notification.listener';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Chatter-style internal feed + @mentions (Wave G3 — migration 038).
 *
 * - FeedService: CRUD + soft-delete + paged "my mentions" inbox. Every
 *   write cross-tenant-validates the polymorphic (entityType,
 *   entityId) and emits one `feed.mention.created` event per
 *   mentioned user AFTER its $transaction commits.
 *
 * - FeedNotificationListener: bridges `feed.mention.created` →
 *   NotificationsService.create() (in-app notification + best-effort
 *   web push). Stamps `feed_mentions.notifiedAt` on success so ops can
 *   re-fire misses.
 *
 * PrismaService and EventEmitter2 come from the global modules wired
 * in AppModule (DatabaseModule + EventEmitterModule.forRoot()).
 * NotificationsModule has to be imported explicitly because the
 * listener consumes its exported NotificationsService provider.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [FeedController],
  providers: [FeedService, FeedNotificationListener],
  exports: [FeedService],
})
export class FeedModule {}
