import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CustomObjectsService } from './custom-objects.service';
import { stripUnknownKeys, validateRecordData } from './validation';

export interface ListRecordsQuery {
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Records are the actual rows of a custom object. Stored as
 * `{ data: jsonb }` keyed by field.key. Every create/update funnels
 * through:
 *   1. resolve slug → object (org-scoped — see findBySlug)
 *   2. load field defs
 *   3. validateRecordData (required + per-type shape)
 *   4. stripUnknownKeys (drop anything not in the field defs)
 *   5. persist
 */
@Injectable()
export class CustomRecordsService {
  constructor(
    private prisma: PrismaService,
    private objects: CustomObjectsService,
  ) {}

  // ─── List / Find ────────────────────────────────────────────

  async list(orgId: string, slug: string, query: ListRecordsQuery = {}) {
    const object = await this.objects.findBySlug(orgId, slug);
    const { search, page = 1, limit: rawLimit = 20 } = query;
    // Hard ceiling so a runaway `?limit=99999` can't pull the whole table.
    const limit = Math.min(rawLimit, 100);
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = {
        organizationId: orgId,
        customObjectId: object.id,
      };

      // Cheap full-text search across all `text` fields.
      // Uses Prisma's path-based json filter so the surface here stays
      // injection-safe even though field keys come from tenant input
      // (they've been validated via validateFieldKey on insert).
      if (search) {
        const textFields = object.fields.filter((f) => f.fieldType === 'text');
        if (textFields.length > 0) {
          where.OR = textFields.map((f) => ({
            data: {
              path: [f.key],
              string_contains: search,
            },
          }));
        }
      }

      const [data, total] = await Promise.all([
        tx.customRecord.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        tx.customRecord.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async findOne(orgId: string, slug: string, recordId: string) {
    const object = await this.objects.findBySlug(orgId, slug);
    return this.prisma.withOrganization(orgId, async (tx) => {
      const record = await tx.customRecord.findFirst({
        where: {
          id: recordId,
          organizationId: orgId,
          customObjectId: object.id,
        },
      });
      if (!record) throw new NotFoundException('Record not found');
      return record;
    });
  }

  // ─── Create / Update / Delete ───────────────────────────────

  async create(
    orgId: string,
    userId: string | null,
    slug: string,
    data: Record<string, any>,
  ) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new BadRequestException('Record data must be an object.');
    }
    const object = await this.objects.findBySlug(orgId, slug);
    const fields = await this.objects.getFieldDefs(orgId, object.id);

    // validateRecordData also strips unknown keys (belt-and-braces) and
    // returns the cleaned blob; we persist that, never the raw input.
    const { data: cleaned } = validateRecordData(fields, data);

    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.customRecord.create({
        data: {
          organizationId: orgId,
          customObjectId: object.id,
          createdById: userId ?? null,
          data: cleaned as any,
        },
      });
    });
  }

  async update(
    orgId: string,
    slug: string,
    recordId: string,
    data: Record<string, any>,
  ) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new BadRequestException('Record data must be an object.');
    }
    const object = await this.objects.findBySlug(orgId, slug);
    const fields = await this.objects.getFieldDefs(orgId, object.id);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.customRecord.findFirst({
        where: {
          id: recordId,
          organizationId: orgId,
          customObjectId: object.id,
        },
      });
      if (!existing) throw new NotFoundException('Record not found');

      // Partial-update: merge over the existing blob so unspecified
      // fields keep their current value. Unknown keys in the patch are
      // dropped first so a buggy client can't silently persist garbage.
      // We also re-run the strip on the merged blob via validateRecordData
      // so any stale key that survived a botched historical deleteField
      // can't re-enter through the merge.
      const patch = stripUnknownKeys(fields, data);
      const merged = {
        ...((existing.data as Record<string, any>) ?? {}),
        ...patch,
      };
      const { data: cleaned } = validateRecordData(fields, merged);

      return tx.customRecord.update({
        where: { id: recordId, organizationId: orgId },
        data: { data: cleaned as any },
      });
    });
  }

  async remove(orgId: string, slug: string, recordId: string) {
    const object = await this.objects.findBySlug(orgId, slug);
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.customRecord.findFirst({
        where: {
          id: recordId,
          organizationId: orgId,
          customObjectId: object.id,
        },
      });
      if (!existing) throw new NotFoundException('Record not found');
      await tx.customRecord.delete({
        where: { id: recordId, organizationId: orgId },
      });
    });
  }
}
