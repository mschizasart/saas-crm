import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PdfService } from '../pdf/pdf.service';
import { renderProposalHtml } from '../pdf/templates/proposal.template';
import { renderContractHtml } from '../pdf/templates/contract.template';

export type DocumentType = 'proposal' | 'contract';

export interface AuditEvent {
  at: string;
  type: 'viewed' | 'started_signing' | 'completed' | 'revoked';
  ip: string;
  userAgent: string;
  detail?: string;
}

export interface SignContext {
  ip: string;
  userAgent: string;
}

/**
 * Signatures service.
 *
 * Polymorphic by `documentType` ∈ { 'proposal' | 'contract' }. There is no
 * FK to the parent table — every parent lookup goes through `findDocument`
 * which dispatches to the correct table. Service-layer enforcement
 * substitutes for a DB FK.
 */
@Injectable()
export class SignaturesService {
  private readonly logger = new Logger(SignaturesService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private pdf: PdfService,
    private events: EventEmitter2,
  ) {}

  // ─── Polymorphic helpers ─────────────────────────────────────────────────

  /** Single source of truth for "fetch the parent document". */
  private async findDocument(documentType: DocumentType, where: any) {
    if (documentType === 'proposal') {
      return (this.prisma as any).proposal.findUnique({
        where,
        include: {
          client: true,
          organization: true,
          items: { orderBy: { order: 'asc' } },
        },
      });
    }
    if (documentType === 'contract') {
      return (this.prisma as any).contract.findUnique({
        where,
        include: { client: true, organization: true },
      });
    }
    throw new BadRequestException(`Unknown documentType: ${documentType}`);
  }

  /** Update parent document (status / signedAt). */
  private async updateDocumentAfterSign(
    documentType: DocumentType,
    documentId: string,
    signedAt: Date,
  ) {
    if (documentType === 'proposal') {
      return (this.prisma as any).proposal.update({
        where: { id: documentId },
        data: { status: 'accepted', signedAt },
      });
    }
    return (this.prisma as any).contract.update({
      where: { id: documentId },
      data: { status: 'active', signedAt },
    });
  }

  /** Revert document state when a signature is revoked. */
  private async revertDocumentForRevocation(
    documentType: DocumentType,
    documentId: string,
  ) {
    if (documentType === 'proposal') {
      return (this.prisma as any).proposal.update({
        where: { id: documentId },
        data: { status: 'sent', signedAt: null },
      });
    }
    return (this.prisma as any).contract.update({
      where: { id: documentId },
      data: { status: 'sent', signedAt: null },
    });
  }

  /** Render the correct PDF template for the document type. */
  private renderDocumentHtml(
    documentType: DocumentType,
    document: any,
    signature: any | null,
  ): string {
    if (documentType === 'proposal') {
      return renderProposalHtml(document, document.organization, signature);
    }
    return renderContractHtml(document, document.organization, signature);
  }

  // ─── MinIO key naming ────────────────────────────────────────────────────
  // PNGs:  orgs/{orgId}/signatures/png/{signatureId}.png
  // PDFs:  orgs/{orgId}/signatures/pdf/{signatureId}.pdf
  // Going through the public StorageService helper means MinIO availability
  // and tenant-prefix enforcement come for free.

  private async uploadSignaturePng(
    orgId: string,
    signatureId: string,
    base64DataUrl: string,
  ): Promise<string> {
    const buf = decodeDataUrl(base64DataUrl);
    if (!buf) {
      throw new BadRequestException('Invalid signature image (expected base64 PNG data URL)');
    }
    const { path } = await this.storage.uploadFile(
      orgId,
      'signatures/png',
      `${signatureId}.png`,
      buf,
      'image/png',
    );
    return path;
  }

  private async uploadSignedPdf(
    orgId: string,
    signatureId: string,
    pdf: Buffer,
  ): Promise<string> {
    const { path } = await this.storage.uploadFile(
      orgId,
      'signatures/pdf',
      `${signatureId}.pdf`,
      pdf,
      'application/pdf',
    );
    return path;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Sign a document (public — called from the portal sign page).
   *
   * Flow:
   *   1. Look up parent document by `hash` (existing public token system).
   *   2. Validate state allows signing.
   *   3. Upload PNG to MinIO.
   *   4. Create Signature row with audit `completed` event (and merge any
   *      placeholder audit events from prior `viewed`/`started_signing`).
   *   5. Update parent document status + denormalized signedAt.
   *   6. Async: render PDF snapshot, upload to MinIO, store key on row.
   *   7. Emit event for downstream listeners (email, automation).
   */
  async sign(
    documentType: DocumentType,
    hash: string,
    body: { name: string; email: string; signaturePng: string },
    ctx: SignContext,
  ) {
    const document = await this.findDocument(documentType, { hash });
    if (!document) throw new NotFoundException(`${documentType} not found`);

    const orgId = document.organizationId as string;
    const documentId = document.id as string;

    // State validation per type.
    if (documentType === 'proposal' && !['sent', 'open'].includes(document.status)) {
      throw new BadRequestException(
        `Proposal cannot be signed in status '${document.status}'`,
      );
    }
    if (documentType === 'contract' && !['sent', 'pending_signature'].includes(document.status)) {
      throw new BadRequestException(
        `Contract cannot be signed in status '${document.status}'`,
      );
    }

    // If a placeholder Signature exists (from `track-view`), reuse it; else create new.
    const placeholder = await this.findActiveSignatureRow(orgId, documentType, documentId);
    const signedAt = new Date();
    const auditTail: AuditEvent[] = [
      {
        at: signedAt.toISOString(),
        type: 'completed',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: `Signed by ${body.name} (${body.email})`,
      },
    ];

    let signature: any;

    if (placeholder && !placeholder.signedAt) {
      // Upgrade the placeholder row.
      const imageKey = await this.uploadSignaturePng(orgId, placeholder.id, body.signaturePng);
      const merged = mergeAuditEvents(placeholder.auditEvents, auditTail);
      signature = await (this.prisma as any).signature.update({
        where: { id: placeholder.id },
        data: {
          signerName: body.name,
          signerEmail: body.email,
          signatureImageKey: imageKey,
          signedAt,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          auditEvents: merged,
        },
      });
    } else {
      // Fresh row.
      const newId = randomId();
      const imageKey = await this.uploadSignaturePng(orgId, newId, body.signaturePng);
      signature = await (this.prisma as any).signature.create({
        data: {
          id: newId,
          organizationId: orgId,
          documentType,
          documentId,
          signerName: body.name,
          signerEmail: body.email,
          signatureImageKey: imageKey,
          signedAt,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          auditEvents: auditTail,
        },
      });
    }

    // Update parent document.
    const updatedDoc = await this.updateDocumentAfterSign(documentType, documentId, signedAt);

    // Snapshot PDF asynchronously (best-effort; signing succeeds even if it fails).
    this.snapshotPdfAsync(documentType, documentId, signature.id).catch((e) => {
      this.logger.warn(`PDF snapshot failed for signature ${signature.id}: ${e?.message}`);
    });

    this.events.emit(`${documentType}.signed`, {
      [documentType]: updatedDoc,
      signature,
      orgId,
    });

    return { success: true, signatureId: signature.id };
  }

  /**
   * Append a `viewed` audit event for the current document. If no Signature
   * row exists yet, create a placeholder row containing only the audit
   * trail. If one already exists (placeholder or completed), append.
   *
   * Idempotent w.r.t. row creation — never creates a second placeholder.
   */
  async trackView(
    documentType: DocumentType,
    documentId: string,
    ctx: SignContext,
  ) {
    // Resolve org via parent doc (no auth — must look up by id directly).
    const doc = await this.findDocument(documentType, { id: documentId });
    if (!doc) throw new NotFoundException(`${documentType} not found`);

    const orgId = doc.organizationId as string;
    const event: AuditEvent = {
      at: new Date().toISOString(),
      type: 'viewed',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    };

    const existing = await this.findActiveSignatureRow(orgId, documentType, documentId);
    if (existing) {
      const merged = mergeAuditEvents(existing.auditEvents, [event]);
      await (this.prisma as any).signature.update({
        where: { id: existing.id },
        data: { auditEvents: merged },
      });
      return { tracked: true, signatureId: existing.id };
    }

    // Create placeholder — completed signature fields are required by the
    // schema, so we use sentinel values until the actual signing event.
    const placeholder = await (this.prisma as any).signature.create({
      data: {
        organizationId: orgId,
        documentType,
        documentId,
        signerName: '',
        signerEmail: '',
        signatureImageKey: '',
        signedAt: new Date(0), // Sentinel — Signed-state checked via `signerName !== ''` & `signedAt > epoch`.
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        auditEvents: [event],
      },
    });
    return { tracked: true, signatureId: placeholder.id };
  }

  /** Find the active (not revoked) Signature row for a given document. */
  private async findActiveSignatureRow(
    orgId: string,
    documentType: DocumentType,
    documentId: string,
  ) {
    return (this.prisma as any).signature.findFirst({
      where: { organizationId: orgId, documentType, documentId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get the active signature for a document (tenant-scoped, requires perm).
   * Returns the row plus a presigned URL for the signature image.
   */
  async getForDocument(
    orgId: string,
    documentType: DocumentType,
    documentId: string,
  ) {
    const sig = await (this.prisma as any).signature.findFirst({
      where: { organizationId: orgId, documentType, documentId },
      orderBy: { createdAt: 'desc' },
    });
    if (!sig) return null;

    let imageUrl: string | null = null;
    if (sig.signatureImageKey) {
      try {
        imageUrl = await this.storage.getSignedUrl(orgId, sig.signatureImageKey, 3600);
      } catch {
        imageUrl = null;
      }
    }

    return {
      ...sig,
      // True if the row has been finalised (vs. a view-only placeholder).
      isCompleted: !!sig.signerName && sig.signedAt && new Date(sig.signedAt).getTime() > 0,
      imageUrl,
    };
  }

  /**
   * Revoke a signature. Reverts the parent document to `sent` and
   * appends a `revoked` audit event.
   */
  async revoke(
    orgId: string,
    documentType: DocumentType,
    documentId: string,
    reason: string,
    ctx: SignContext,
  ) {
    const sig = await (this.prisma as any).signature.findFirst({
      where: { organizationId: orgId, documentType, documentId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!sig) throw new NotFoundException('No active signature to revoke');

    const event: AuditEvent = {
      at: new Date().toISOString(),
      type: 'revoked',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      detail: reason || 'Revoked by staff',
    };
    const merged = mergeAuditEvents(sig.auditEvents, [event]);

    await (this.prisma as any).signature.update({
      where: { id: sig.id },
      data: { revokedAt: new Date(), revokedReason: reason || null, auditEvents: merged },
    });

    await this.revertDocumentForRevocation(documentType, documentId);

    this.events.emit(`${documentType}.signature_revoked`, {
      orgId,
      documentId,
      signatureId: sig.id,
      reason,
    });

    return { success: true };
  }

  /**
   * Stream the snapshotted PDF. If the snapshot is missing (e.g. async
   * write hasn't completed yet, or pre-feature-flag row), generate a fresh
   * PDF on the fly using the current document state + signature.
   */
  async getSignedPdf(
    orgId: string,
    documentType: DocumentType,
    documentId: string,
  ): Promise<Buffer> {
    const sig = await (this.prisma as any).signature.findFirst({
      where: { organizationId: orgId, documentType, documentId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (sig?.signedDocumentPdfKey) {
      try {
        // Use the MinIO client's getObject through a presigned URL would also work,
        // but for a simple buffer we re-fetch via storage.
        return await fetchObject(this.storage, orgId, sig.signedDocumentPdfKey);
      } catch (e) {
        this.logger.warn(`Falling back to fresh PDF — getObject failed: ${(e as any)?.message}`);
      }
    }

    // Fallback: render fresh.
    const doc = await this.findDocument(documentType, { id: documentId });
    if (!doc) throw new NotFoundException(`${documentType} not found`);
    const signaturePayload = sig
      ? await this.buildSignaturePayload(orgId, sig)
      : null;
    const html = this.renderDocumentHtml(documentType, doc, signaturePayload);
    return this.pdf.generatePdf(html);
  }

  /**
   * Build the payload passed to PDF templates: includes a base64 data URL
   * for the signature PNG (Puppeteer renders it inline).
   */
  private async buildSignaturePayload(orgId: string, sig: any) {
    let dataUrl: string | null = null;
    if (sig.signatureImageKey) {
      try {
        const buf = await fetchObject(this.storage, orgId, sig.signatureImageKey);
        dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
      } catch {
        dataUrl = null;
      }
    }
    return {
      signerName: sig.signerName,
      signerEmail: sig.signerEmail,
      signedAt: sig.signedAt,
      ipAddress: sig.ipAddress,
      imageDataUrl: dataUrl,
    };
  }

  /** Render → upload PDF; called async after a successful signing. */
  private async snapshotPdfAsync(
    documentType: DocumentType,
    documentId: string,
    signatureId: string,
  ) {
    const sig = await (this.prisma as any).signature.findUnique({ where: { id: signatureId } });
    if (!sig) return;
    const doc = await this.findDocument(documentType, { id: documentId });
    if (!doc) return;
    const payload = await this.buildSignaturePayload(sig.organizationId, sig);
    const html = this.renderDocumentHtml(documentType, doc, payload);
    const pdf = await this.pdf.generatePdf(html);
    const key = await this.uploadSignedPdf(sig.organizationId, sig.id, pdf);
    await (this.prisma as any).signature.update({
      where: { id: sig.id },
      data: { signedDocumentPdfKey: key },
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function decodeDataUrl(dataUrl: string): Buffer | null {
  if (!dataUrl) return null;
  // Accept either a raw base64 string or a full data: URL.
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  const b64 = m ? m[1] : dataUrl;
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 32) return null; // sanity
    return buf;
  } catch {
    return null;
  }
}

function mergeAuditEvents(existing: any, additions: AuditEvent[]): AuditEvent[] {
  const arr: AuditEvent[] = Array.isArray(existing) ? (existing as AuditEvent[]) : [];
  return [...arr, ...additions];
}

function randomId(): string {
  // Avoid pulling crypto into the type surface — use Web Crypto when available.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomUUID } = require('crypto');
  return randomUUID();
}

/**
 * Fetch a stored object as a Buffer. The StorageService doesn't expose a
 * direct getObject helper; we use the underlying client.
 */
async function fetchObject(
  storage: StorageService,
  orgId: string,
  filePath: string,
): Promise<Buffer> {
  // Hit the MinIO client directly — `(storage as any).client` is the raw
  // minio.Client. We assert the orgId-prefix here to keep the same scoping
  // contract enforced by the public storage methods.
  if (!filePath.startsWith(`orgs/${orgId}/`)) {
    throw new Error('Object path is outside the organization scope');
  }
  const client = (storage as any).client;
  const bucket = (storage as any).bucket;
  if (!client || !bucket) throw new Error('Storage backend not available');
  const stream = await client.getObject(bucket, filePath);
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve());
    stream.on('error', (e: any) => reject(e));
  });
  return Buffer.concat(chunks);
}
