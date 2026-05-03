import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { SearchIndexerService } from './search-indexer.service';

export interface SearchReindexJob {
  orgId: string;
}

/**
 * Worker for `general` queue jobs named `search-reindex-org`.
 * Rebuilds the full `search_index` slice for one org from scratch.
 *
 * Triggered by:
 *   - SearchIndexerService.onApplicationBootstrap() — backfill on first
 *     deploy of migration 012 (one job per org with clients but no index).
 *   - POST /api/v1/search/reindex — admin-triggered manual rebuild.
 */
@Processor('general')
export class SearchReindexProcessor extends WorkerHost {
  private readonly logger = new Logger(SearchReindexProcessor.name);

  constructor(private readonly indexer: SearchIndexerService) {
    super();
  }

  async process(job: Job<SearchReindexJob>) {
    if (job.name !== 'search-reindex-org') {
      // The `general` queue is shared; ignore jobs that aren't ours.
      return;
    }
    const { orgId } = job.data;
    this.logger.log(`search-reindex start: org=${orgId} job=${job.id}`);
    const result = await this.indexer.reindexAll(orgId);
    this.logger.log(
      `search-reindex done: org=${orgId} indexed=${result.total}`,
    );
    return result;
  }
}
