import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchIndexerService } from './search-indexer.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';

@ApiTags('Search')
@Controller({ version: '1', path: 'search' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly indexer: SearchIndexerService,
  ) {}

  @Get()
  async search(
    @CurrentOrg() org: { id: string },
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    return this.searchService.search(
      org.id,
      q,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  /**
   * Manually rebuild the cross-record search index for the current org.
   * Enqueues a BullMQ `search-reindex-org` job (see SearchReindexProcessor)
   * and returns immediately — the actual reindex runs out-of-band.
   *
   * Use cases:
   *   - After importing legacy data.
   *   - After bulk-edits that don't go through the event bus.
   *   - Recovering from an indexer outage / event bus loss.
   *
   * Auth: settings.edit (admin/manager only).
   */
  @Post('reindex')
  @HttpCode(202)
  @Permissions('settings.edit')
  async reindex(@CurrentOrg() org: { id: string }) {
    await this.indexer.enqueueReindex(org.id);
    return { queued: true };
  }
}
