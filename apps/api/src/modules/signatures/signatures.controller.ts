import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions, Public } from '../../common/decorators/permissions.decorator';
import { SignaturesService, DocumentType } from './signatures.service';

/** Pull request metadata (IP / UA). Fastify uses `req.ip` and `req.headers`. */
function ctxFromReq(req: any) {
  const forwarded = (req.headers?.['x-forwarded-for'] as string) || '';
  const ip =
    (forwarded.split(',')[0] || '').trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown';
  const userAgent = (req.headers?.['user-agent'] as string) || 'unknown';
  return { ip, userAgent };
}

// ───────────────────────────────────────────────────────────────────────────
// Public sign endpoints — keyed by the parent document's hash (existing
// public-view token). No auth, no orgId scoping.
// ───────────────────────────────────────────────────────────────────────────
@ApiTags('Signatures (public)')
@Controller({ version: '1', path: 'public' })
export class PublicSignaturesController {
  constructor(private service: SignaturesService) {}

  @Post('proposals/:token/sign')
  @Public()
  @ApiOperation({ summary: 'Public — client signs a proposal' })
  signProposal(
    @Param('token') token: string,
    @Body() body: { name: string; email: string; signaturePng: string },
    @Req() req: any,
  ) {
    return this.service.sign('proposal', token, body, ctxFromReq(req));
  }

  @Post('contracts/:token/sign')
  @Public()
  @ApiOperation({ summary: 'Public — client signs a contract' })
  signContract(
    @Param('token') token: string,
    @Body() body: { name: string; email: string; signaturePng: string },
    @Req() req: any,
  ) {
    return this.service.sign('contract', token, body, ctxFromReq(req));
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Track-view endpoints — these are public (no JWT) but addressed by the
// internal document id (not the public hash) because they're called from
// the portal page after it has resolved the document. This avoids creating
// a phantom-row vector via the hash endpoint.
// ───────────────────────────────────────────────────────────────────────────
@ApiTags('Signatures (track)')
@Controller({ version: '1' })
export class TrackViewController {
  constructor(private service: SignaturesService) {}

  @Post('proposals/:id/track-view')
  @Public()
  @ApiOperation({ summary: 'Public — record a portal view event for a proposal' })
  trackProposalView(@Param('id') id: string, @Req() req: any) {
    return this.service.trackView('proposal', id, ctxFromReq(req));
  }

  @Post('contracts/:id/track-view')
  @Public()
  @ApiOperation({ summary: 'Public — record a portal view event for a contract' })
  trackContractView(@Param('id') id: string, @Req() req: any) {
    return this.service.trackView('contract', id, ctxFromReq(req));
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Authenticated admin endpoints. Mounted under proposals/:id and contracts/:id
// for ergonomic URLs, but live in this module to keep all signature logic
// in one place.
// ───────────────────────────────────────────────────────────────────────────
@ApiTags('Signatures (admin)')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class AdminSignaturesController {
  constructor(private service: SignaturesService) {}

  @Get('proposals/:id/signature')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get the signature + audit trail for a proposal' })
  getProposalSignature(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getForDocument(org.id, 'proposal', id);
  }

  @Get('contracts/:id/signature')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get the signature + audit trail for a contract' })
  getContractSignature(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getForDocument(org.id, 'contract', id);
  }

  @Get('proposals/:id/signed-pdf')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Download the snapshotted (or freshly rendered) signed proposal PDF' })
  async getProposalPdf(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Res() res: any,
  ) {
    const pdf = await this.service.getSignedPdf(org.id, 'proposal', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="proposal-${id}-signed.pdf"`,
    );
    res.send(pdf);
  }

  @Get('contracts/:id/signed-pdf')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Download the snapshotted (or freshly rendered) signed contract PDF' })
  async getContractPdf(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Res() res: any,
  ) {
    const pdf = await this.service.getSignedPdf(org.id, 'contract', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="contract-${id}-signed.pdf"`,
    );
    res.send(pdf);
  }

  @Post('proposals/:id/signature/revoke')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Revoke the active signature on a proposal (audited)' })
  revokeProposal(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: any,
  ) {
    return this.service.revoke(org.id, 'proposal', id, body?.reason || '', {
      ...ctxFromReq(req),
      userAgent: user?.email
        ? `${ctxFromReq(req).userAgent} (staff:${user.email})`
        : ctxFromReq(req).userAgent,
    });
  }

  @Post('contracts/:id/signature/revoke')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Revoke the active signature on a contract (audited)' })
  revokeContract(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: any,
  ) {
    return this.service.revoke(org.id, 'contract', id, body?.reason || '', {
      ...ctxFromReq(req),
      userAgent: user?.email
        ? `${ctxFromReq(req).userAgent} (staff:${user.email})`
        : ctxFromReq(req).userAgent,
    });
  }
}
