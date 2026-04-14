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
import { TagsService, CreateTagDto, UpdateTagDto } from './tags.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

interface AssignTagDto {
  taggableType: string;
  taggableId: string;
  tagId: string;
}

@ApiTags('Tags')
@Controller({ version: '1', path: 'tags' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class TagsController {
  constructor(private service: TagsService) {}

  @Get()
  @ApiOperation({ summary: 'List all tags' })
  findAll(@CurrentOrg() org: any) {
    return this.service.findAll(org.id);
  }

  @Post()
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Create tag' })
  create(@CurrentOrg() org: any, @Body() dto: CreateTagDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Update tag' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateTagDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete tag' })
  async remove(@CurrentOrg() org: any, @Param('id') id: string) {
    await this.service.delete(org.id, id);
  }

  @Post('assign')
  @ApiOperation({ summary: 'Assign a tag to an entity' })
  assign(@CurrentOrg() org: any, @Body() dto: AssignTagDto) {
    return this.service.assignTag(
      org.id,
      dto.taggableType,
      dto.taggableId,
      dto.tagId,
    );
  }

  @Delete('assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a tag from an entity' })
  async unassign(@CurrentOrg() org: any, @Body() dto: AssignTagDto) {
    await this.service.removeTag(
      org.id,
      dto.taggableType,
      dto.taggableId,
      dto.tagId,
    );
  }

  @Get('for/:type/:id')
  @ApiOperation({ summary: 'Get tags for a given entity' })
  getFor(
    @CurrentOrg() org: any,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return this.service.getTagsFor(org.id, type, id);
  }

  @Get('by/:id')
  @ApiOperation({ summary: 'Find entities with a given tag' })
  findByTag(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Query('type') type?: string,
  ) {
    return this.service.findByTag(org.id, id, type);
  }
}
