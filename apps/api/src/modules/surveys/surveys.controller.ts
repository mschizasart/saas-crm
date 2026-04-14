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
  SurveysService,
  CreateSurveyDto,
  UpdateSurveyDto,
} from './surveys.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import {
  Permissions,
  Public,
} from '../../common/decorators/permissions.decorator';

@ApiTags('Surveys')
@Controller({ version: '1', path: 'surveys' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class SurveysController {
  constructor(private service: SurveysService) {}

  // ─── Public endpoints (no auth) ────────────────────────────────────────────
  @Get('public/:hash')
  @Public()
  @ApiOperation({ summary: 'Get public survey by hash' })
  getPublic(@Param('hash') hash: string) {
    return this.service.getByHash(hash);
  }

  @Post('public/:hash/submit')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a public survey' })
  submitPublic(
    @Param('hash') hash: string,
    @Body() body: { answers: Record<string, any>; email?: string; clientId?: string },
  ) {
    return this.service.submit(hash, body.answers ?? {}, {
      email: body.email,
      clientId: body.clientId,
    });
  }

  // ─── Authenticated endpoints ───────────────────────────────────────────────
  @Get()
  @Permissions('settings.view')
  @ApiOperation({ summary: 'List all surveys' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('active') active?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      active:
        active === 'true' ? true : active === 'false' ? false : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  @Permissions('settings.view')
  @ApiOperation({ summary: 'Get survey by id' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Create survey' })
  create(@CurrentOrg() org: any, @Body() dto: CreateSurveyDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Update survey' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateSurveyDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete survey' })
  async remove(@CurrentOrg() org: any, @Param('id') id: string) {
    await this.service.delete(org.id, id);
  }

  @Get(':id/submissions')
  @Permissions('settings.view')
  @ApiOperation({ summary: 'List survey submissions' })
  submissions(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getSubmissions(org.id, id, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id/results')
  @Permissions('settings.view')
  @ApiOperation({ summary: 'Get aggregated survey results' })
  results(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getResults(org.id, id);
  }
}
