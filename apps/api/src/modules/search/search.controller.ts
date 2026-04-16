import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';

@ApiTags('Search')
@Controller({ version: '1', path: 'search' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  async search(
    @CurrentOrg() org: { id: string },
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    return this.searchService.search(org.id, q, limit ? parseInt(limit, 10) : 10);
  }
}
