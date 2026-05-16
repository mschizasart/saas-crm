import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AiConfigService,
  AiProviderKind,
  UpsertAiSettingsDto,
} from './ai-config.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

/**
 * Per-tenant AI provider configuration. Mirrors EmailSettingsController:
 * GET (redacted) / PUT (upsert, encrypt-on-write) / POST test.
 */
@ApiTags('AI Settings')
@Controller({ version: '1', path: 'ai-settings' })
@ApiBearerAuth()
export class AiSettingsController {
  constructor(private service: AiConfigService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.view')
  @ApiOperation({ summary: 'Get this org AI provider settings (API key redacted)' })
  get(@CurrentOrg() org: any) {
    return this.service.getForOrg(org.id);
  }

  @Put()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Upsert AI provider settings for this org' })
  upsert(@CurrentOrg() org: any, @Body() body: UpsertAiSettingsDto) {
    return this.service.upsert(org.id, body);
  }

  @Post('test')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Test the AI connection — uses saved config when body is empty, or an override (provider/apiKey/model) to test before saving',
  })
  test(
    @CurrentOrg() org: any,
    @Body()
    body: { provider?: AiProviderKind; apiKey?: string; model?: string } = {},
  ) {
    const override =
      body.provider === 'ANTHROPIC' || body.provider === 'OPENAI'
        ? { provider: body.provider, apiKey: body.apiKey, model: body.model }
        : undefined;
    return this.service.testConnection(org.id, override);
  }
}
