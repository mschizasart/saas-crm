import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Documents')
@Controller({ version: '1', path: 'documents' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class DocumentsController {
  constructor(private service: DocumentsService) {}

  // ── Download (literal "version" prefix — declared first) ─────

  @Get('version/:versionId/download')
  @ApiOperation({ summary: 'Stream a specific version file (attachment)' })
  async download(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('versionId') versionId: string,
    @Res() res: any,
  ) {
    const { stream, size, mimeType, fileName } =
      await this.service.getVersionForDownload(org.id, user, versionId);

    res.header('Content-Type', mimeType || 'application/octet-stream');
    if (size) res.header('Content-Length', String(size));
    res.header(
      'Content-Disposition',
      `attachment; filename="${this.safeHeaderName(fileName)}"`,
    );
    // Fastify's reply.send() accepts a Node Readable stream and pipes it.
    return res.send(stream);
  }

  // ── New version of an existing document ──────────────────────

  @Post(':documentId/versions')
  @ApiOperation({ summary: 'Upload a new version of an existing document' })
  @ApiConsumes('multipart/form-data')
  async uploadVersion(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('documentId') documentId: string,
    @Req() req: any,
  ) {
    const input = await this.parseMultipart(req);
    return this.service.addVersion(org.id, user, documentId, input);
  }

  // ── Version history ──────────────────────────────────────────

  @Get(':documentId/versions')
  @ApiOperation({ summary: 'Full version history for a document' })
  listVersions(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('documentId') documentId: string,
  ) {
    return this.service.listVersions(org.id, user, documentId);
  }

  // ── Restore an old version ───────────────────────────────────

  @Post(':documentId/restore/:versionId')
  @ApiOperation({ summary: 'Make an old version the current one (repoint)' })
  restore(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.service.restoreVersion(org.id, user, documentId, versionId);
  }

  // ── Delete a document (hard) ─────────────────────────────────

  @Delete(':documentId')
  @ApiOperation({ summary: 'Delete a document and all its versions' })
  remove(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('documentId') documentId: string,
  ) {
    return this.service.deleteDocument(org.id, user, documentId);
  }

  // ── Upload v1 to a record ────────────────────────────────────

  @Post(':entityType/:entityId')
  @ApiOperation({ summary: 'Upload a file attachment to a record (v1)' })
  @ApiConsumes('multipart/form-data')
  async upload(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Req() req: any,
  ) {
    const input = await this.parseMultipart(req);
    return this.service.createDocument(org.id, user, entityType, entityId, input);
  }

  // ── List documents for a record ──────────────────────────────

  @Get(':entityType/:entityId')
  @ApiOperation({ summary: 'List documents attached to a record' })
  list(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.service.listForEntity(org.id, user, entityType, entityId);
  }

  // ── Multipart parsing (Fastify @fastify/multipart) ───────────
  //
  // Follows the canonical pattern in clients.controller.ts /
  // storage.controller.ts — iterate req.parts() and toBuffer() the file
  // part. We read an optional `note` field too. NOT multer/FileInterceptor.

  private async parseMultipart(req: any) {
    if (typeof req.parts !== 'function') {
      throw new BadRequestException(
        'Multipart not supported — @fastify/multipart not registered',
      );
    }

    let buffer: Buffer | null = null;
    let fileName = '';
    let mimeType = 'application/octet-stream';
    let note: string | undefined;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        fileName = part.filename || 'upload';
        mimeType = part.mimetype || 'application/octet-stream';
        buffer = await part.toBuffer();
      } else if (part.type === 'field' && part.fieldname === 'note') {
        note = String(part.value ?? '') || undefined;
      }
    }

    if (!buffer || !fileName) {
      throw new BadRequestException('No file in request (field name: "file")');
    }

    return { buffer, fileName, mimeType, note };
  }

  /** Strip characters that would break a Content-Disposition header. */
  private safeHeaderName(name: string): string {
    return (name || 'download').replace(/["\\\r\n]/g, '_');
  }
}
