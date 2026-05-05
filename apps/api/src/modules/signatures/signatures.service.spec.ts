import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { SignaturesService } from './signatures.service';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PdfService } from '../pdf/pdf.service';

// Minimal valid base64 PNG header (≥32 bytes after decode) so decodeDataUrl
// passes the sanity check.
const PNG_BASE64 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  'utf8',
).toString();
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

describe('SignaturesService', () => {
  let service: SignaturesService;
  let prisma: DeepMocked<PrismaService>;
  let storage: DeepMocked<StorageService>;
  let pdf: DeepMocked<PdfService>;
  let events: DeepMocked<EventEmitter2>;

  const ORG_ID = 'org_abc';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    storage = createMock<StorageService>();
    pdf = createMock<PdfService>();
    events = createMock<EventEmitter2>();
    service = new SignaturesService(prisma, storage, pdf, events);

    storage.uploadFile.mockResolvedValue({
      path: `orgs/${ORG_ID}/signatures/png/abc.png`,
      url: 'http://minio/x',
    });
  });

  describe('sign — proposal flow', () => {
    it('throws NotFoundException when the parent document is missing', async () => {
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.sign(
          'proposal',
          'h',
          { name: 'A', email: 'a@x.com', signaturePng: PNG_DATA_URL },
          { ip: '1.1.1.1', userAgent: 'jest' },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses to sign a proposal that is in the wrong state', async () => {
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        organizationId: ORG_ID,
        status: 'declined',
      });
      await expect(
        service.sign(
          'proposal',
          'h',
          { name: 'A', email: 'a@x.com', signaturePng: PNG_DATA_URL },
          { ip: '1.1.1.1', userAgent: 'jest' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid signature image (too small / not a PNG data URL)', async () => {
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        organizationId: ORG_ID,
        status: 'sent',
      });
      (prisma.signature.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.sign(
          'proposal',
          'h',
          { name: 'A', email: 'a@x.com', signaturePng: 'too-short' },
          { ip: '1.1.1.1', userAgent: 'jest' },
        ),
      ).rejects.toThrow(/Invalid signature image/);
    });

    it('creates a fresh signature row, updates proposal, and emits proposal.signed', async () => {
      const proposal = {
        id: 'p1',
        organizationId: ORG_ID,
        status: 'sent',
      };
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue(proposal);
      (prisma.signature.findFirst as jest.Mock).mockResolvedValue(null);
      const signature = { id: 'sig_1' };
      (prisma.signature.create as jest.Mock).mockResolvedValue(signature);
      const updatedDoc = { ...proposal, status: 'accepted' };
      (prisma.proposal.update as jest.Mock).mockResolvedValue(updatedDoc);
      // Snapshot path no-ops if findUnique returns null
      (prisma.signature.findUnique as jest.Mock).mockResolvedValue(null);

      const r = await service.sign(
        'proposal',
        'h',
        { name: 'Alice', email: 'a@x.com', signaturePng: PNG_DATA_URL },
        { ip: '5.5.5.5', userAgent: 'jest' },
      );

      expect(storage.uploadFile).toHaveBeenCalledWith(
        ORG_ID,
        'signatures/png',
        expect.stringMatching(/\.png$/),
        expect.any(Buffer),
        'image/png',
      );
      expect(prisma.signature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            documentType: 'proposal',
            documentId: 'p1',
            signerName: 'Alice',
            signerEmail: 'a@x.com',
            ipAddress: '5.5.5.5',
          }),
        }),
      );
      expect(prisma.proposal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
          data: expect.objectContaining({ status: 'accepted' }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'proposal.signed',
        expect.objectContaining({
          proposal: updatedDoc,
          signature,
          orgId: ORG_ID,
        }),
      );
      expect(r).toEqual({ success: true, signatureId: 'sig_1' });
    });

    it('upgrades a placeholder signature row instead of creating a duplicate', async () => {
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        organizationId: ORG_ID,
        status: 'sent',
      });
      const placeholder = {
        id: 'sig_placeholder',
        signedAt: null,
        auditEvents: [{ type: 'viewed' }],
      };
      (prisma.signature.findFirst as jest.Mock).mockResolvedValue(placeholder);
      const updated = { id: 'sig_placeholder' };
      (prisma.signature.update as jest.Mock).mockResolvedValue(updated);
      (prisma.proposal.update as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: 'accepted',
      });
      (prisma.signature.findUnique as jest.Mock).mockResolvedValue(null);

      const r = await service.sign(
        'proposal',
        'h',
        { name: 'B', email: 'b@x.com', signaturePng: PNG_DATA_URL },
        { ip: '1.1.1.1', userAgent: 'jest' },
      );

      expect(prisma.signature.create).not.toHaveBeenCalled();
      expect(prisma.signature.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sig_placeholder' },
          data: expect.objectContaining({
            signerName: 'B',
            signerEmail: 'b@x.com',
            // Audit trail must be preserved (placeholder + completed)
            auditEvents: expect.arrayContaining([
              expect.objectContaining({ type: 'viewed' }),
              expect.objectContaining({ type: 'completed' }),
            ]),
          }),
        }),
      );
      expect(r.signatureId).toBe('sig_placeholder');
    });
  });

  describe('sign — contract flow', () => {
    it('refuses if contract is in the wrong state', async () => {
      (prisma.contract.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        organizationId: ORG_ID,
        status: 'active',
      });
      await expect(
        service.sign(
          'contract',
          'h',
          { name: 'A', email: 'a@x.com', signaturePng: PNG_DATA_URL },
          { ip: '1.1.1.1', userAgent: 'jest' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('flips contract to "active" on successful sign', async () => {
      (prisma.contract.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        organizationId: ORG_ID,
        status: 'pending_signature',
      });
      (prisma.signature.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.signature.create as jest.Mock).mockResolvedValue({ id: 'sig' });
      (prisma.contract.update as jest.Mock).mockResolvedValue({
        id: 'c1',
        status: 'active',
      });
      (prisma.signature.findUnique as jest.Mock).mockResolvedValue(null);

      await service.sign(
        'contract',
        'h',
        { name: 'A', email: 'a@x.com', signaturePng: PNG_DATA_URL },
        { ip: '1.1.1.1', userAgent: 'jest' },
      );

      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'active' }),
        }),
      );
    });
  });

  describe('trackView', () => {
    it('appends a viewed event to an existing signature row', async () => {
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        organizationId: ORG_ID,
        status: 'sent',
      });
      const existing = { id: 'sig_1', auditEvents: [{ type: 'viewed' }] };
      (prisma.signature.findFirst as jest.Mock).mockResolvedValue(existing);
      (prisma.signature.update as jest.Mock).mockResolvedValue({});

      const r = await service.trackView('proposal', 'p1', {
        ip: '1.1.1.1',
        userAgent: 'jest',
      });

      expect(prisma.signature.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sig_1' },
          data: expect.objectContaining({
            auditEvents: expect.arrayContaining([
              expect.objectContaining({ type: 'viewed' }),
            ]),
          }),
        }),
      );
      expect(r).toEqual({ tracked: true, signatureId: 'sig_1' });
    });

    it('creates a placeholder row when none exists', async () => {
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        organizationId: ORG_ID,
        status: 'sent',
      });
      (prisma.signature.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.signature.create as jest.Mock).mockResolvedValue({
        id: 'sig_new',
      });

      const r = await service.trackView('proposal', 'p1', {
        ip: '2.2.2.2',
        userAgent: 'jest',
      });

      expect(prisma.signature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: ORG_ID,
            documentType: 'proposal',
            documentId: 'p1',
            signerName: '',
            signerEmail: '',
            signedAt: new Date(0),
          }),
        }),
      );
      expect(r.tracked).toBe(true);
    });
  });

  describe('revoke', () => {
    it('throws NotFoundException when there is no active signature', async () => {
      (prisma.signature.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.revoke(ORG_ID, 'proposal', 'p1', 'unauthorized', {
          ip: '1.1.1.1',
          userAgent: 'jest',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('stamps revokedAt, reverts the document, and emits *.signature_revoked', async () => {
      const sig = {
        id: 'sig_1',
        auditEvents: [{ type: 'completed' }],
      };
      (prisma.signature.findFirst as jest.Mock).mockResolvedValue(sig);
      (prisma.signature.update as jest.Mock).mockResolvedValue({});
      (prisma.proposal.update as jest.Mock).mockResolvedValue({});

      await service.revoke(ORG_ID, 'proposal', 'p1', 'mistake', {
        ip: '1.1.1.1',
        userAgent: 'jest',
      });

      expect(prisma.signature.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sig_1' },
          data: expect.objectContaining({
            revokedAt: expect.any(Date),
            revokedReason: 'mistake',
            auditEvents: expect.arrayContaining([
              expect.objectContaining({ type: 'revoked' }),
            ]),
          }),
        }),
      );
      // Parent reverts to sent
      expect(prisma.proposal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'sent', signedAt: null }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'proposal.signature_revoked',
        expect.objectContaining({ orgId: ORG_ID, documentId: 'p1' }),
      );
    });
  });

  describe('getForDocument', () => {
    it('returns null when no signature exists', async () => {
      (prisma.signature.findFirst as jest.Mock).mockResolvedValue(null);
      const r = await service.getForDocument(ORG_ID, 'proposal', 'p1');
      expect(r).toBeNull();
    });

    it('marks isCompleted=false for a placeholder (signedAt = epoch / no signerName)', async () => {
      (prisma.signature.findFirst as jest.Mock).mockResolvedValue({
        id: 'sig_1',
        signerName: '',
        signedAt: new Date(0),
        signatureImageKey: '',
      });
      const r: any = await service.getForDocument(ORG_ID, 'proposal', 'p1');
      expect(r.isCompleted).toBe(false);
    });

    it('marks isCompleted=true for a fully completed signature row', async () => {
      storage.getSignedUrl.mockResolvedValue('http://signed/img');
      (prisma.signature.findFirst as jest.Mock).mockResolvedValue({
        id: 'sig_1',
        signerName: 'Alice',
        signedAt: new Date('2025-01-01T00:00:00Z'),
        signatureImageKey: `orgs/${ORG_ID}/signatures/png/sig_1.png`,
      });
      const r: any = await service.getForDocument(ORG_ID, 'proposal', 'p1');
      expect(r.isCompleted).toBe(true);
      expect(r.imageUrl).toBe('http://signed/img');
    });
  });
});
