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
import { GoalsService, CreateGoalDto } from './goals.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Goals')
@Controller({ version: '1', path: 'goals' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GoalsController {
  constructor(private service: GoalsService) {}

  @Get('my')
  @ApiOperation({ summary: 'Goals for the current user' })
  getMy(@CurrentOrg() org: any, @CurrentUser() user: any) {
    return this.service.getMyGoals(org.id, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List goals' })
  findAll(
    @CurrentOrg() org: any,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      userId,
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single goal' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a goal' })
  create(@CurrentOrg() org: any, @Body() dto: CreateGoalDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a goal' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateGoalDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a goal' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  @Patch(':id/progress')
  @ApiOperation({ summary: 'Update goal progress (achieved amount)' })
  updateProgress(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { achieved: number },
  ) {
    return this.service.updateProgress(org.id, id, body.achieved);
  }
}
