import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface CreateCustomFieldDto {
  fieldTo: string;
  name: string;
  fieldType: string; // mapped to schema field `type`
  options?: string[];
  required?: boolean;
  showInList?: boolean;
  showInForm?: boolean;
  order?: number;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

@Injectable()
export class CustomFieldsService {
  constructor(private prisma: PrismaService) {}

  async findAll(orgId: string, fieldTo?: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.customField.findMany({
        where: {
          organizationId: orgId,
          ...(fieldTo ? { fieldTo } : {}),
        },
        orderBy: { order: 'asc' },
      });
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const field = await tx.customField.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!field) throw new NotFoundException('Custom field not found');
      return field;
    });
  }

  async create(orgId: string, dto: CreateCustomFieldDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.customField.create({
        data: {
          organizationId: orgId,
          fieldTo: dto.fieldTo,
          name: dto.name,
          slug: slugify(dto.name),
          type: dto.fieldType,
          options: dto.options ?? [],
          required: dto.required ?? false,
          showOnTable: dto.showInList ?? false,
          // NOTE: schema has no `showInForm` column — mapped to `active`
          active: dto.showInForm ?? true,
          order: dto.order ?? 0,
        },
      });
    });
  }

  async update(orgId: string, id: string, dto: Partial<CreateCustomFieldDto>) {
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.customField.update({
        where: { id },
        data: {
          ...(dto.fieldTo !== undefined && { fieldTo: dto.fieldTo }),
          ...(dto.name !== undefined && { name: dto.name, slug: slugify(dto.name) }),
          ...(dto.fieldType !== undefined && { type: dto.fieldType }),
          ...(dto.options !== undefined && { options: dto.options }),
          ...(dto.required !== undefined && { required: dto.required }),
          ...(dto.showInList !== undefined && { showOnTable: dto.showInList }),
          ...(dto.showInForm !== undefined && { active: dto.showInForm }),
          ...(dto.order !== undefined && { order: dto.order }),
        },
      });
    });
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      // Cascade delete of values is configured at the DB level,
      // but we explicitly clear them to be safe.
      await tx.customFieldValue.deleteMany({ where: { fieldId: id } });
      await tx.customField.delete({ where: { id } });
    });
  }

  /**
   * Return list of { field, value } for a specific entity.
   */
  async getValuesForEntity(orgId: string, fieldTo: string, entityId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const fields = await tx.customField.findMany({
        where: { organizationId: orgId, fieldTo, active: true },
        orderBy: { order: 'asc' },
      });
      if (fields.length === 0) return [];

      const values = await tx.customFieldValue.findMany({
        where: {
          organizationId: orgId,
          relType: fieldTo,
          relId: entityId,
          fieldId: { in: fields.map((f: any) => f.id) },
        },
      });

      const valueMap = new Map<string, any>();
      for (const v of values) valueMap.set(v.fieldId, v.value);

      return fields.map((field: any) => ({
        field,
        value: valueMap.get(field.id) ?? null,
      }));
    });
  }

  /**
   * Upsert CustomFieldValue rows. Values keys may be either field slug or id.
   */
  async setValues(
    orgId: string,
    fieldTo: string,
    entityId: string,
    values: Record<string, any>,
  ) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const fields = await tx.customField.findMany({
        where: { organizationId: orgId, fieldTo },
      });
      const bySlug = new Map<string, any>();
      const byId = new Map<string, any>();
      for (const f of fields) {
        bySlug.set(f.slug, f);
        byId.set(f.id, f);
      }

      const ops: Promise<any>[] = [];
      for (const [key, rawValue] of Object.entries(values)) {
        const field = byId.get(key) ?? bySlug.get(key);
        if (!field) continue;
        const stringValue =
          rawValue === null || rawValue === undefined ? null : String(rawValue);
        ops.push(
          tx.customFieldValue.upsert({
            where: {
              fieldId_relId: { fieldId: field.id, relId: entityId },
            },
            create: {
              organizationId: orgId,
              fieldId: field.id,
              relType: fieldTo,
              relId: entityId,
              value: stringValue,
            },
            update: { value: stringValue },
          }),
        );
      }
      await Promise.all(ops);
      return this.getValuesForEntity(orgId, fieldTo, entityId);
    });
  }
}
