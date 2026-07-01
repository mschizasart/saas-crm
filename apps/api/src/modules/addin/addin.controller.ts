import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AddinService } from './addin.service';
import {
  AddinContextDto,
  AddinCreateContactDto,
  AddinCreateLeadDto,
  AddinLogEmailDto,
} from './addin.dto';

/**
 * Backend for the Outlook email add-in (Office.js taskpane). The
 * add-in user logs in and acts as themselves — the org is taken from
 * the JWT (request.organization → org.id), so every endpoint is
 * inherently tenant-scoped. CORS for outlook.office.com is opened in
 * main.ts.
 */
@ApiTags('Add-in')
@ApiBearerAuth()
@Controller({ version: '1', path: 'addin' })
@UseGuards(JwtAuthGuard)
export class AddinController {
  constructor(private readonly service: AddinService) {}

  /** Resolve CRM context (record + recent activity) for a sender. */
  @Post('context')
  context(@CurrentOrg() org: any, @Body() dto: AddinContextDto) {
    return this.service.getContext(org.id, dto);
  }

  /** Log an email to the CRM timeline. */
  @Post('log-email')
  logEmail(@CurrentOrg() org: any, @Body() dto: AddinLogEmailDto) {
    return this.service.logEmail(org.id, dto);
  }

  /** Create a lead from the current email. */
  @Post('create-lead')
  createLead(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: AddinCreateLeadDto,
  ) {
    return this.service.createLead(org.id, user.id ?? user.sub, dto);
  }

  /** Create a portal contact under an existing client. */
  @Post('create-contact')
  createContact(@CurrentOrg() org: any, @Body() dto: AddinCreateContactDto) {
    return this.service.createContact(org.id, dto);
  }
}
