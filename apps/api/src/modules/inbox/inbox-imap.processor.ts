import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ImapConnectorService } from './imap-connector.service';

export interface InboxImapJob {
  orgId: string;
}

/**
 * Per-org IMAP poll worker. Triggered by InboxScheduler every 5 min.
 * Concurrency is throttled by BullMQ; we keep it simple here and let
 * the connector enforce its own per-poll caps.
 */
@Processor('inbox-imap')
export class InboxImapProcessor extends WorkerHost {
  private readonly logger = new Logger(InboxImapProcessor.name);

  constructor(private readonly connector: ImapConnectorService) {
    super();
  }

  async process(job: Job<InboxImapJob>) {
    const { orgId } = job.data;
    this.logger.log(`Inbox IMAP poll start: org=${orgId} job=${job.id}`);
    const result = await this.connector.pollOrg(orgId);
    this.logger.log(
      `Inbox IMAP poll done: org=${orgId} fetched=${result.fetched} inserted=${result.inserted} routed=${JSON.stringify(result.routed)}${result.skipped ? ` skipped=${result.skipped}` : ''}`,
    );
    return result;
  }
}
