import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';

// ───────────────────────────────────────────────────────────────
//  Entity registry
// ───────────────────────────────────────────────────────────────
//
// Maps the polymorphic `entityType` to:
//   - prismaModel: the Prisma delegate used to verify the parent record
//     exists in the caller's org (every one of these tables has an
//     `organizationId` column).
//   - resource:    the RBAC resource prefix. `view`/`edit` actions are
//     derived from this (e.g. invoices → invoices.view / invoices.edit).
//
// Uploading/deleting/restoring requires `<resource>.edit`; listing and
// downloading require `<resource>.view`.

interface EntityConfig {
  prismaModel: string;
  resource: string;
}

const ENTITY_REGISTRY: Record<string, EntityConfig> = {
  client: { prismaModel: 'client', resource: 'clients' },
  invoice: { prismaModel: 'invoice', resource: 'invoices' },
  estimate: { prismaModel: 'estimate', resource: 'estimates' },
  project: { prismaModel: 'project', resource: 'projects' },
  ticket: { prismaModel: 'ticket', resource: 'tickets' },
  lead: { prismaModel: 'lead', resource: 'leads' },
};

export const ALLOWED_ENTITY_TYPES = Object.keys(ENTITY_REGISTRY);

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

export interface UploadInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  note?: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ── Permission helpers ──────────────────────────────────────
  //
  // Permissions are entity-type-dependent (uploading to an invoice needs
  // invoices.edit, etc.) so they can't be expressed with the static
  // @Permissions() decorator. We replicate the RbacGuard's resolution
  // logic — role permissions + per-user overrides, with the same
  // super-admin / portal bypasses — against the dynamically-chosen
  // resource.

  private async assertPermission(
    user: any,
    entityType: string,
    action: 'view' | 'edit',
  ): Promise<void> {
    const config = this.getConfig(entityType);
    const permission = `${config.resource}.${action}`;

    // Super-admins bypass all RBAC; portal contacts handled like RbacGuard.
    if (user?.isAdmin) return;
    if (user?.type === 'contact') return;

    const rolePermissions: Record<string, Record<string, boolean>> =
      user?.role?.permissions || {};
    const roleHas = (() => {
      const [resource, act] = permission.split('.');
      return rolePermissions?.[resource]?.[act] === true;
    })();

    let overrideGrant: boolean | undefined;
    if (user?.id) {
      try {
        const override = await (
          this.prisma as any
        ).userPermissionOverride.findFirst({
          where: { userId: user.id, permission },
          select: { grant: true },
        });
        if (override) overrideGrant = override.grant;
      } catch {
        overrideGrant = undefined;
      }
    }

    const allowed = overrideGrant !== undefined ? overrideGrant : roleHas;
    if (!allowed) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
  }

  private getConfig(entityType: string): EntityConfig {
    const config = ENTITY_REGISTRY[entityType];
    if (!config) {
      throw new BadRequestException(
        `Invalid entityType "${entityType}". Allowed: ${ALLOWED_ENTITY_TYPES.join(', ')}`,
      );
    }
    return config;
  }

  /** Verify the parent record exists in the caller's org. */
  private async assertEntityExists(
    orgId: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    const config = this.getConfig(entityType);
    const delegate = (this.prisma as any)[config.prismaModel];
    const found = await delegate.findFirst({
      where: { id: entityId, organizationId: orgId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException(`${entityType} not found`);
    }
  }

  // ── Serialization ───────────────────────────────────────────

  private serializeVersion(v: any) {
    if (!v) return null;
    return {
      id: v.id,
      documentId: v.documentId,
      version: v.version,
      fileName: v.fileName,
      mimeType: v.mimeType,
      sizeBytes: v.sizeBytes,
      uploadedById: v.uploadedById,
      note: v.note,
      createdAt: v.createdAt,
    };
  }

  private async serializeDocument(doc: any) {
    const current = doc.versions?.find(
      (v: any) => v.id === doc.currentVersionId,
    );
    const versionCount = doc.versions?.length ?? 0;
    return {
      id: doc.id,
      entityType: doc.entityType,
      entityId: doc.entityId,
      name: doc.name,
      createdById: doc.createdById,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      versionCount,
      currentVersion: this.serializeVersion(current),
    };
  }

  // ── Create (upload v1) ──────────────────────────────────────

  async createDocument(
    orgId: string,
    user: any,
    entityType: string,
    entityId: string,
    input: UploadInput,
  ) {
    await this.assertPermission(user, entityType, 'edit');
    await this.assertEntityExists(orgId, entityType, entityId);
    this.assertFile(input);

    const { path } = await this.storage.uploadFile(
      orgId,
      'documents',
      this.versionedFileName(input.fileName, 1),
      input.buffer,
      input.mimeType,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const doc = await (tx as any).document.create({
        data: {
          organizationId: orgId,
          entityType,
          entityId,
          name: input.fileName,
          createdById: user?.id ?? null,
        },
      });
      const version = await (tx as any).documentVersion.create({
        data: {
          documentId: doc.id,
          organizationId: orgId,
          version: 1,
          storageKey: path,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.buffer.length,
          uploadedById: user?.id ?? null,
          note: input.note ?? null,
        },
      });
      const updated = await (tx as any).document.update({
        where: { id: doc.id },
        data: { currentVersionId: version.id },
        include: { versions: true },
      });
      return updated;
    });

    return this.serializeDocument(created);
  }

  // ── Add a new version of an existing document ───────────────

  async addVersion(
    orgId: string,
    user: any,
    documentId: string,
    input: UploadInput,
  ) {
    const doc = await this.findDocOrThrow(orgId, documentId);
    await this.assertPermission(user, doc.entityType, 'edit');
    this.assertFile(input);

    const latest = await (this.prisma as any).documentVersion.findFirst({
      where: { documentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const { path } = await this.storage.uploadFile(
      orgId,
      'documents',
      this.versionedFileName(input.fileName, nextVersion),
      input.buffer,
      input.mimeType,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const version = await (tx as any).documentVersion.create({
        data: {
          documentId,
          organizationId: orgId,
          version: nextVersion,
          storageKey: path,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.buffer.length,
          uploadedById: user?.id ?? null,
          note: input.note ?? null,
        },
      });
      return (tx as any).document.update({
        where: { id: documentId },
        data: { currentVersionId: version.id, name: input.fileName },
        include: { versions: true },
      });
    });

    return this.serializeDocument(updated);
  }

  // ── List documents for a record ─────────────────────────────

  async listForEntity(
    orgId: string,
    user: any,
    entityType: string,
    entityId: string,
  ) {
    await this.assertPermission(user, entityType, 'view');
    this.getConfig(entityType); // validates entityType
    const docs = await (this.prisma as any).document.findMany({
      where: { organizationId: orgId, entityType, entityId },
      include: { versions: true },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(docs.map((d: any) => this.serializeDocument(d)));
  }

  // ── Full version history ────────────────────────────────────

  async listVersions(orgId: string, user: any, documentId: string) {
    const doc = await this.findDocOrThrow(orgId, documentId);
    await this.assertPermission(user, doc.entityType, 'view');
    const versions = await (this.prisma as any).documentVersion.findMany({
      where: { documentId },
      orderBy: { version: 'desc' },
    });
    return {
      documentId,
      name: doc.name,
      currentVersionId: doc.currentVersionId,
      versions: versions.map((v: any) => this.serializeVersion(v)),
    };
  }

  // ── Download (resolve a version + verify org) ───────────────

  async getVersionForDownload(orgId: string, user: any, versionId: string) {
    const version = await (this.prisma as any).documentVersion.findUnique({
      where: { id: versionId },
      include: { document: true },
    });
    if (!version || version.organizationId !== orgId) {
      throw new NotFoundException('Version not found');
    }
    await this.assertPermission(user, version.document.entityType, 'view');
    const { stream, size, mimeType } = await this.storage.fetchObject(
      orgId,
      version.storageKey,
    );
    return {
      stream,
      size: size || version.sizeBytes,
      mimeType: version.mimeType || mimeType,
      fileName: version.fileName,
    };
  }

  // ── Restore an old version ──────────────────────────────────
  //
  // Strategy: we simply REPOINT `currentVersionId` at the chosen old
  // version. We do NOT create a new version or copy the storage object —
  // every version's bytes are immutable and already in MinIO, so a repoint
  // is sufficient, avoids duplicate storage, and keeps the version history
  // linear (no synthetic "restored from vN" rows). The restored version
  // becomes the current one while all versions remain downloadable.

  async restoreVersion(
    orgId: string,
    user: any,
    documentId: string,
    versionId: string,
  ) {
    const doc = await this.findDocOrThrow(orgId, documentId);
    await this.assertPermission(user, doc.entityType, 'edit');

    const version = await (this.prisma as any).documentVersion.findUnique({
      where: { id: versionId },
      select: { id: true, documentId: true, organizationId: true, fileName: true },
    });
    if (
      !version ||
      version.organizationId !== orgId ||
      version.documentId !== documentId
    ) {
      throw new NotFoundException('Version not found for this document');
    }

    const updated = await (this.prisma as any).document.update({
      where: { id: documentId },
      data: { currentVersionId: version.id, name: version.fileName },
      include: { versions: true },
    });
    return this.serializeDocument(updated);
  }

  // ── Delete (hard) ───────────────────────────────────────────
  //
  // Hard delete for v1: remove all version objects from MinIO, then the
  // DB rows (versions cascade-delete with the document).

  async deleteDocument(orgId: string, user: any, documentId: string) {
    const doc = await this.findDocOrThrow(orgId, documentId);
    await this.assertPermission(user, doc.entityType, 'edit');

    const versions = await (this.prisma as any).documentVersion.findMany({
      where: { documentId },
      select: { storageKey: true },
    });

    for (const v of versions) {
      try {
        await this.storage.deleteFile(orgId, v.storageKey);
      } catch {
        // Best-effort — a missing object shouldn't block the DB cleanup.
      }
    }

    await (this.prisma as any).document.delete({ where: { id: documentId } });
    return { ok: true };
  }

  // ── Internal helpers ────────────────────────────────────────

  private async findDocOrThrow(orgId: string, documentId: string) {
    const doc = await (this.prisma as any).document.findUnique({
      where: { id: documentId },
    });
    if (!doc || doc.organizationId !== orgId) {
      throw new NotFoundException('Document not found');
    }
    return doc;
  }

  private assertFile(input: UploadInput) {
    if (!input.buffer || input.buffer.length === 0 || !input.fileName) {
      throw new BadRequestException('No file in request (field name: "file")');
    }
    if (input.buffer.length > MAX_BYTES) {
      throw new PayloadTooLargeException('File exceeds the 25MB limit');
    }
  }

  /**
   * MinIO key naming: the StorageService sanitizes the filename and
   * prefixes it with `orgs/{orgId}/documents/`. We add a per-version
   * uniqueness suffix so concurrent uploads of the same filename (or
   * successive versions) never collide on the same object key. Final key
   * shape:
   *   orgs/{orgId}/documents/v{n}-{epochMs}-{rand}-{sanitized-name}
   */
  private versionedFileName(fileName: string, version: number): string {
    const rand = Math.random().toString(36).slice(2, 8);
    return `v${version}-${Date.now()}-${rand}-${fileName}`;
  }
}
