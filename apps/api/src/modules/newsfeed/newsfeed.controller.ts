import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NewsfeedService } from './newsfeed.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Newsfeed')
@Controller({ version: '1', path: 'newsfeed' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NewsfeedController {
  constructor(private service: NewsfeedService) {}

  @Get()
  findAll(@CurrentOrg() org: any, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(org.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post()
  create(@CurrentOrg() org: any, @CurrentUser() user: any, @Body() body: { content: string }) {
    return this.service.create(org.id, user.id, body.content);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentOrg() org: any, @CurrentUser() user: any, @Param('id') id: string) {
    return this.service.delete(org.id, id, user.id, user.isAdmin);
  }

  @Post(':id/like')
  like(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.like(org.id, id);
  }
}
