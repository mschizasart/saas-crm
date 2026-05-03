import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SearchIndexerService } from './search-indexer.service';
import { SearchReindexProcessor } from './search-reindex.processor';

/**
 * Cross-record full-text search module.
 *
 * Components:
 *   - SearchService          → executes the FTS query against `search_index`.
 *   - SearchIndexerService   → keeps `search_index` in sync via domain
 *                              events + a one-shot reindex job.
 *   - SearchReindexProcessor → BullMQ worker on the `general` queue that
 *                              runs `SearchIndexerService.reindexAll`.
 *
 * The `general` queue is registered globally in QueueModule; we re-import
 * its registration here so `@InjectQueue('general')` works in the indexer.
 */
@Module({
  imports: [BullModule.registerQueue({ name: 'general' })],
  controllers: [SearchController],
  providers: [SearchService, SearchIndexerService, SearchReindexProcessor],
  exports: [SearchService, SearchIndexerService],
})
export class SearchModule {}
