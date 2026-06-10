import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  CreatePostDto,
  ListPostsQueryDto,
  MyMentionsQueryDto,
  UpdatePostDto,
} from './feed.dto';
import { FeedService } from './feed.service';

/**
 * Chatter-style internal feed endpoints (Wave G3).
 *
 * Read permission: `feed.view`.
 * Create:           `feed.create`.
 * Edit/delete:      `feed.edit_own` — the SERVICE additionally
 *                   enforces author-only edit + the 5-min window,
 *                   and falls back to `feed.moderate` for cross-author
 *                   deletes.
 *
 * `/feed/mentions/my` is intentionally a `feed.view`-only route — the
 * user's own mention inbox is just a view of the feed they already
 * have read access to.
 */
@ApiTags('Feed')
@Controller({ version: '1', path: 'feed' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class FeedController {
  constructor(private service: FeedService) {}

  // ─── Mentions inbox (declared BEFORE /:id so it isn't shadowed) ───

  @Get('mentions/my')
  @Permissions('feed.view')
  @ApiOperation({ summary: 'Current user\'s recent @mentions (paged)' })
  myMentions(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Query() query: MyMentionsQueryDto,
  ) {
    return this.service.getMyRecentMentions(org.id, user.id, query);
  }

  // ─── List + find ─────────────────────────────────────────────

  @Get()
  @Permissions('feed.view')
  @ApiOperation({ summary: 'List posts for a record (paged, threaded)' })
  list(@CurrentOrg() org: any, @Query() query: ListPostsQueryDto) {
    return this.service.list(org.id, query);
  }

  @Get(':id')
  @Permissions('feed.view')
  @ApiOperation({ summary: 'Fetch a single post with its replies' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  // ─── Mutations ───────────────────────────────────────────────

  @Post()
  @Permissions('feed.create')
  @ApiOperation({ summary: 'Post a note (top-level or reply)' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreatePostDto,
  ) {
    return this.service.create(org.id, user.id, dto);
  }

  @Put(':id')
  @Permissions('feed.edit_own')
  @ApiOperation({
    summary: 'Edit a post (author-only, within 5 minutes of creation)',
  })
  update(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.service.update(org.id, user.id, id, dto);
  }

  @Delete(':id')
  @Permissions('feed.edit_own')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Soft-delete a post. Author may delete their own; moderators (feed.moderate) may delete any.',
  })
  remove(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    // The Permissions decorator only gates entry. The fine-grained
    // moderator-vs-author check happens inside the service, which
    // resolves the effective `feed.moderate` permission the same way
    // RbacGuard does (super-admin > per-user override > role).
    return this.service.softDelete(org.id, user.id, id);
  }
}
