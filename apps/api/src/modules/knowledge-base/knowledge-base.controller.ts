import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  KnowledgeBaseService,
  CreateArticleDto,
} from './knowledge-base.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  Permissions,
  Public,
} from '../../common/decorators/permissions.decorator';

@ApiTags('Knowledge Base')
@Controller({ version: '1', path: 'knowledge-base' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class KnowledgeBaseController {
  constructor(private service: KnowledgeBaseService) {}

  // ─── Groups ────────────────────────────────────────────────────────────────

  @Get('groups')
  @Public()
  @ApiOperation({ summary: 'List all knowledge base groups (public)' })
  getGroups(@CurrentOrg() org: any) {
    return this.service.getGroups(org.id);
  }

  @Post('groups')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Create a knowledge base group' })
  createGroup(
    @CurrentOrg() org: any,
    @Body() body: { name: string; color?: string; icon?: string },
  ) {
    return this.service.createGroup(org.id, body.name, body.color, body.icon);
  }

  @Patch('groups/:id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Update a knowledge base group' })
  updateGroup(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: { name?: string; color?: string; icon?: string; order?: number },
  ) {
    return this.service.updateGroup(org.id, id, dto);
  }

  @Delete('groups/:id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a knowledge base group (must have no articles)' })
  deleteGroup(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.deleteGroup(org.id, id);
  }

  // ─── Search (public) ──────────────────────────────────────────────────────

  @Get('search')
  @Public()
  @ApiOperation({ summary: 'Full-text search knowledge base articles (public)' })
  search(@CurrentOrg() org: any, @Query('q') q: string) {
    return this.service.search(org.id, q ?? '');
  }

  // ─── List (admin) ─────────────────────────────────────────────────────────

  @Get()
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'List all knowledge base articles (paginated, filterable)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('groupId') groupId?: string,
    @Query('active') active?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      groupId,
      active: active !== undefined ? active === 'true' : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // ─── Article by slug (public) ─────────────────────────────────────────────

  @Get('article/:slug')
  @Public()
  @ApiOperation({ summary: 'Get an article by slug (public, increments views)' })
  findBySlug(@CurrentOrg() org: any, @Param('slug') slug: string) {
    return this.service.findBySlug(org.id, slug);
  }

  // ─── Single article (admin) ───────────────────────────────────────────────

  @Get(':id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Get a single article by ID (admin)' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  @Post()
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Create a new knowledge base article' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateArticleDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  @Patch(':id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Update a knowledge base article' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateArticleDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a knowledge base article' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }
}
