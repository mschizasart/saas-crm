import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions, Public } from '../../common/decorators/permissions.decorator';

interface OnboardingPatchBody {
  step?: string;
  skip?: boolean;
  complete?: boolean;
  orgUpdates?: Record<string, any>;
}

interface InviteTeamBody {
  invites: Array<{ email: string; role?: 'admin' | 'staff' }>;
}

interface BrandingPutBody {
  logo?: string | null;
  brandPrimaryColor?: string | null;
  brandSidebarColor?: string | null;
  brandFaviconUrl?: string | null;
  brandEmailFooter?: string | null;
  whiteLabelEnabled?: boolean;
}

@ApiTags('Organizations')
@Controller({ version: '1', path: 'organizations' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class OrganizationsController {
  constructor(
    private service: OrganizationsService,
    private users: UsersService,
  ) {}

  @Get('current')
  async getCurrent(@CurrentOrg() org: any) {
    return org;
  }

  @Patch('profile')
  @Permissions('settings.edit')
  async updateProfile(@CurrentOrg() org: any, @Body() body: any) {
    return this.service.updateProfile(org.id, body);
  }

  @Patch('settings')
  @Permissions('settings.edit')
  async updateSettings(@CurrentOrg() org: any, @Body() body: any) {
    return this.service.updateSettings(org.id, body);
  }

  @Get('usage')
  async getUsage(@CurrentOrg() org: any) {
    return this.service.getUsageStats(org.id);
  }

  // ─── Onboarding wizard ─────────────────────────────────────
  //
  // The wizard is URL-driven on the web; server state is the source of
  // truth (no localStorage). See `apps/web/app/(admin)/onboarding/*`.

  @Get('me/onboarding')
  @ApiOperation({ summary: 'Get onboarding wizard state for current org' })
  async getOnboarding(@CurrentOrg() org: any) {
    return this.service.getOnboarding(org.id);
  }

  @Patch('me/onboarding')
  @Permissions('settings.edit')
  @ApiOperation({
    summary: 'Advance / skip / complete onboarding (+ optional org updates)',
  })
  async patchOnboarding(
    @CurrentOrg() org: any,
    @Body() body: OnboardingPatchBody,
  ) {
    return this.service.updateOnboarding(org.id, body ?? {});
  }

  @Post('me/onboarding/reset')
  @Permissions('settings.edit')
  @ApiOperation({
    summary: 'Reset onboarding state — used by the "Re-run tour" link in Settings',
  })
  async resetOnboarding(@CurrentOrg() org: any) {
    return this.service.resetOnboarding(org.id);
  }

  // ─── White-label branding ─────────────────────────────────
  //
  // GET is readable by any authenticated org user (the web app needs it to
  // theme the shell). PUT is gated by `settings.edit`. Colors are validated
  // server-side (strict hex) to prevent CSS injection.

  @Get('me/branding')
  @ApiOperation({ summary: 'Get white-label branding for current org' })
  async getBranding(@CurrentOrg() org: any) {
    return this.service.getBranding(org.id);
  }

  @Put('me/branding')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Upsert white-label branding for current org' })
  async putBranding(@CurrentOrg() org: any, @Body() body: BrandingPutBody) {
    return this.service.updateBranding(org.id, body ?? {});
  }

  @Post('me/invite-team')
  @Permissions('users.create')
  @ApiOperation({
    summary: 'Bulk-invite teammates (delegates to UsersService.create)',
  })
  async inviteTeam(@CurrentOrg() org: any, @Body() body: InviteTeamBody) {
    if (!body?.invites || !Array.isArray(body.invites) || body.invites.length === 0) {
      throw new BadRequestException('At least one invite required');
    }
    const results: Array<{
      email: string;
      ok: boolean;
      userId?: string;
      error?: string;
    }> = [];

    for (const invite of body.invites) {
      const email = (invite?.email ?? '').trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        results.push({ email, ok: false, error: 'Invalid email' });
        continue;
      }
      try {
        // Synthesise a placeholder name from the email — admins can edit
        // after the invitee accepts. We delegate to UsersService.create so
        // the password/email-notification path matches the normal flow.
        const localPart = email.split('@')[0];
        const created = await this.users.create(org.id, {
          email,
          firstName: localPart,
          lastName: '',
          isAdmin: invite.role === 'admin',
        });
        results.push({ email, ok: true, userId: created.id });
      } catch (err: any) {
        results.push({
          email,
          ok: false,
          error: err?.message ?? 'Failed to invite',
        });
      }
    }

    return { invites: results };
  }

  // ─── Taxes ─────────────────────────────────────────────────

  @Get('taxes')
  async getTaxes(@CurrentOrg() org: any) {
    return this.service.getTaxes(org.id);
  }

  @Post('taxes')
  @Permissions('settings.edit')
  async createTax(@CurrentOrg() org: any, @Body() body: { name: string; rate: number }) {
    return this.service.createTax(org.id, body.name, body.rate);
  }

  @Patch('taxes/:id')
  @Permissions('settings.edit')
  async updateTax(@CurrentOrg() org: any, @Param('id') id: string, @Body() body: { name?: string; rate?: number }) {
    return this.service.updateTax(org.id, id, body);
  }

  @Delete('taxes/:id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTax(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.deleteTax(org.id, id);
  }

  // ─── Currencies ───────────────────────────────────────────

  @Get('currencies')
  async getCurrencies(@CurrentOrg() org: any) {
    return this.service.getCurrencies(org.id);
  }

  @Post('currencies')
  @Permissions('settings.edit')
  async createCurrency(@CurrentOrg() org: any, @Body() body: { name: string; symbol: string; symbolPlacement?: string; decimalSeparator?: string; thousandSeparator?: string; decimalPlaces?: number; isDefault?: boolean; exchangeRate?: number }) {
    return this.service.createCurrency(org.id, body);
  }

  @Patch('currencies/:id')
  @Permissions('settings.edit')
  async updateCurrency(@CurrentOrg() org: any, @Param('id') id: string, @Body() body: any) {
    return this.service.updateCurrency(org.id, id, body);
  }

  @Delete('currencies/:id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCurrency(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.deleteCurrency(org.id, id);
  }
}
