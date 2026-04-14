import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';

/**
 * Every 5 minutes, enqueue an 'imap-poll' job for each organization
 * that has IMAP enabled in its settings.
 */
@Injectable()
export class ImapScheduler {
  private readonly logger = new Logger(ImapScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('imap-poll') private readonly imapQueue: Queue,
  ) {}

  @Cron('*/5 * * * *')
  async scheduleImapPolls() {
    let orgs: any[] = [];
    try {
      // JSON settings containment – Postgres/Prisma supports `path`+`equals`
      // but keeping it permissive: fetch all, filter in JS.
      orgs = await (this.prisma as any).organization.findMany({
        select: { id: true, settings: true },
      });
    } catch (err) {
      this.logger.error(
        `Failed to load organizations: ${(err as Error).message}`,
      );
      return;
    }

    let enqueued = 0;
    for (const org of orgs) {
      const imap = (org.settings as any)?.imap;
      if (!imap || !imap.enabled || !imap.host || !imap.user) continue;
      try {
        await this.imapQueue.add(
          'poll',
          { orgId: org.id },
          {
            attempts: 2,
            backoff: { type: 'exponential', delay: 15000 },
            removeOnComplete: 500,
            removeOnFail: 1000,
            jobId: `imap-poll:${org.id}`, // de-dupe in-flight polls
          },
        );
        enqueued++;
      } catch (err) {
        this.logger.error(
          `Failed to enqueue imap poll for ${org.id}: ${(err as Error).message}`,
        );
      }
    }
    if (enqueued > 0) {
      this.logger.log(`Enqueued ${enqueued} IMAP poll job(s)`);
    }
  }
}
