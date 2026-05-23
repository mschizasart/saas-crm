import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  SmsConfigService,
  UpsertSmsSettingsDto,
} from './sms-config.service';
import { SmsSendGuard } from './sms-send.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

/**
 * Per-tenant Twilio SMS. Mirrors EmailSettingsController / AiSettingsController:
 * GET (redacted) / PUT (upsert, encrypt-on-write) / POST test, plus the
 * send + thread endpoints for the ticket/lead detail panels.
 */
@ApiTags('SMS')
@Controller({ version: '1', path: 'sms' })
@ApiBearerAuth()
export class SmsController {
  constructor(private service: SmsConfigService) {}

  @Get('settings')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.view')
  @ApiOperation({ summary: 'Get this org SMS (Twilio) settings (auth token redacted)' })
  getSettings(@CurrentOrg() org: any) {
    return this.service.getForOrg(org.id);
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Upsert SMS (Twilio) settings for this org' })
  upsertSettings(@CurrentOrg() org: any, @Body() body: UpsertSmsSettingsDto) {
    return this.service.upsert(org.id, body);
  }

  @Post('settings/test')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send a test SMS using saved config, or an override (accountSid/authToken/fromNumber) to test before saving',
  })
  test(
    @CurrentOrg() org: any,
    @Body()
    body: {
      to: string;
      accountSid?: string;
      authToken?: string;
      fromNumber?: string;
    },
  ) {
    const override =
      body.accountSid || body.authToken || body.fromNumber
        ? {
            accountSid: body.accountSid,
            authToken: body.authToken,
            fromNumber: body.fromNumber,
          }
        : undefined;
    return this.service.sendTest(org.id, body.to, override);
  }

  @Post('send')
  @UseGuards(JwtAuthGuard, SmsSendGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send an SMS for this org and log it. Permission is tied to entityType (tickets.edit / leads.edit / clients.edit).',
  })
  send(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body()
    body: {
      to: string;
      body: string;
      entityType?: string;
      entityId?: string;
    },
  ) {
    return this.service.sendForOrg(org.id, {
      to: body.to,
      body: body.body,
      entityType: body.entityType ?? null,
      entityId: body.entityId ?? null,
      sentById: user?.id ?? null,
    });
  }

  @Get('thread')
  // Permission is entity-type-dependent (a ticket thread needs tickets.view,
  // etc.), so it can't be expressed with the static @Permissions() decorator.
  // The service enforces `<resource>.view` for the given entityType — same
  // pattern as the Documents panel — so thread access matches the record's
  // read permission and a staff member can't read a thread for an entity type
  // they cannot view.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @ApiOperation({ summary: 'List the SMS thread for a CRM record (both directions, chronological)' })
  thread(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
  ) {
    if (!entityType || !entityId) return [];
    return this.service.thread(org.id, entityType, entityId, user);
  }
}
