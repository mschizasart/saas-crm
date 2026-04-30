import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RoutedTarget } from './router.service';

/**
 * Tiny helper used by EmailsService and feature modules that send mail
 * tied to a specific record. Records the RFC822 Message-ID returned by
 * nodemailer so the inbox router can later thread reply mail.
 *
 * Recording is best-effort — failures are logged but never block sending.
 */
@Injectable()
export class OutboundTrackerService {
  private readonly logger = new Logger(OutboundTrackerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    organizationId: string;
    messageId: string | null | undefined;
    routedTo: Exclude<RoutedTarget, 'unmatched'>;
    routedToId: string;
    subject?: string | null;
  }): Promise<void> {
    const { organizationId, messageId, routedTo, routedToId, subject } = params;
    if (!messageId || !organizationId || !routedToId) return;
    try {
      await this.prisma.withOrganization(organizationId, (tx: any) =>
        tx.outboundMessage.createMany({
          data: [
            {
              organizationId,
              messageId,
              routedTo,
              routedToId,
              subject: subject ?? null,
              sentAt: new Date(),
            },
          ],
          // Same Message-ID arriving twice (e.g. retry on duplicate send)
          // is harmless — keep the first.
          skipDuplicates: true,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to record outbound messageId=${messageId} for ${routedTo}:${routedToId}: ${(err as Error).message}`,
      );
    }
  }
}
