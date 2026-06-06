import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  FieldDef,
  FieldType,
  validateFieldDef,
  validateFieldKey,
  validateSlug,
} from './validation';

export interface CreateCustomObjectDto {
  name: string;
  slug: string;
  pluralName: string;
  icon?: string | null;
}

export interface UpdateCustomObjectDto {
  name?: string;
  pluralName?: string;
  icon?: string | null;
  // Slug is intentionally NOT included — it's part of the URL contract.
  // Even if a client tries to set it, we ignore it. See update() below.
}

export interface CreateFieldDto {
  label: string;
  key: string;
  fieldType: FieldType;
  options?: Record<string, any> | null;
  required?: boolean;
  order?: number;
}

export interface UpdateFieldDto {
  label?: string;
  fieldType?: FieldType;
  options?: Record<string, any> | null;
  required?: boolean;
  order?: number;
  // `key` is NOT editable — it's used as the jsonb key on every record.
}

/**
 * Manages custom-object definitions and their field schemas.
 * Record-level operations live in custom-records.service.ts.
 */
@Injectable()
export class CustomObjectsService {
  constructor(private prisma: PrismaService) {}

  // ─── Objects ─────────────────────────────────────────────────

  list(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.customObject.findMany({
        where: { organizationId: orgId },
        orderBy: { name: 'asc' },
        include: {
          fields: { orderBy: { order: 'asc' } },
          _count: { select: { records: true } },
        },
      });
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const obj = await tx.customObject.findFirst({
        where: { id, organizationId: orgId },
        include: {
          fields: { orderBy: { order: 'asc' } },
          _count: { select: { records: true } },
        },
      });
      if (!obj) throw new NotFoundException('Custom object not found');
      return obj;
    });
  }

  /**
   * Resolve a slug to its custom-object row WITHIN THE GIVEN ORG. This
   * is the security-critical resolver used by every record endpoint —
   * the `organizationId` filter is what prevents one tenant's slug from
   * accidentally addressing another tenant's object.
   */
  async findBySlug(orgId: string, slug: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const obj = await tx.customObject.findFirst({
        where: { organizationId: orgId, slug },
        include: { fields: { orderBy: { order: 'asc' } } },
      });
      if (!obj) throw new NotFoundException('Custom object not found');
      return obj;
    });
  }

  async create(orgId: string, dto: CreateCustomObjectDto) {
    if (!dto.name || typeof dto.name !== 'string') {
      throw new BadRequestException('Name is required.');
    }
    if (!dto.pluralName || typeof dto.pluralName !== 'string') {
      throw new BadRequestException('Plural name is required.');
    }
    validateSlug(dto.slug);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.customObject.findFirst({
        where: { organizationId: orgId, slug: dto.slug },
      });
      if (existing) {
        throw new BadRequestException(
          `A custom object with slug "${dto.slug}" already exists.`,
        );
      }
      return tx.customObject.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          slug: dto.slug,
          pluralName: dto.pluralName,
          icon: dto.icon ?? null,
        },
      });
    });
  }

  /**
   * Update an object's display metadata. Slug is intentionally not
   * editable — it's the public URL key. If records exist we also
   * refuse fieldType changes elsewhere; the slug guard is here.
   */
  async update(orgId: string, id: string, dto: UpdateCustomObjectDto) {
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.customObject.update({
        where: { id, organizationId: orgId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.pluralName !== undefined && { pluralName: dto.pluralName }),
          ...(dto.icon !== undefined && { icon: dto.icon }),
        },
      });
    });
  }

  /**
   * Refuse to delete an object that still has records. The cascade in
   * the schema would silently drop them — too easy to do by accident, so
   * the API forces the tenant to delete records first.
   */
  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      const recordCount = await tx.customRecord.count({
        where: { organizationId: orgId, customObjectId: id },
      });
      if (recordCount > 0) {
        throw new BadRequestException(
          `Cannot delete custom object: ${recordCount} record(s) still exist. ` +
            'Delete the records first.',
        );
      }
      // Fields cascade via the FK; safe to drop the object directly.
      await tx.customObject.delete({ where: { id, organizationId: orgId } });
    });
  }

  // ─── Fields ──────────────────────────────────────────────────

  async addField(orgId: string, objectId: string, dto: CreateFieldDto) {
    await this.findOne(orgId, objectId);
    validateFieldKey(dto.key);
    validateFieldDef({
      label: dto.label,
      key: dto.key,
      fieldType: dto.fieldType,
      options: dto.options ?? {},
      required: dto.required,
    });

    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.customObjectField.findFirst({
        where: { customObjectId: objectId, key: dto.key },
      });
      if (existing) {
        throw new BadRequestException(
          `A field with key "${dto.key}" already exists on this object.`,
        );
      }
      const maxOrder = await tx.customObjectField.aggregate({
        where: { customObjectId: objectId },
        _max: { order: true },
      });
      return tx.customObjectField.create({
        data: {
          organizationId: orgId,
          customObjectId: objectId,
          label: dto.label,
          key: dto.key,
          fieldType: dto.fieldType,
          options: (dto.options ?? {}) as any,
          required: dto.required ?? false,
          order: dto.order ?? (maxOrder._max.order ?? -1) + 1,
        },
      });
    });
  }

  /**
   * Update a field's metadata. `fieldType` may only be changed if no
   * records exist yet — otherwise the existing jsonb values would silently
   * fail validation forever. `key` is never editable.
   */
  async updateField(
    orgId: string,
    objectId: string,
    fieldId: string,
    dto: UpdateFieldDto,
  ) {
    await this.findOne(orgId, objectId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const field = await tx.customObjectField.findFirst({
        where: {
          id: fieldId,
          customObjectId: objectId,
          organizationId: orgId,
        },
      });
      if (!field) throw new NotFoundException('Field not found');

      if (dto.fieldType !== undefined && dto.fieldType !== field.fieldType) {
        const recordCount = await tx.customRecord.count({
          where: { organizationId: orgId, customObjectId: objectId },
        });
        if (recordCount > 0) {
          throw new BadRequestException(
            'Cannot change a field type after records have been created. ' +
              'Delete the records first, or create a new field with the new type.',
          );
        }
      }

      // Re-validate the merged shape so partial updates can't slip
      // a bad relatedEntity / choices payload past the validator.
      const merged = {
        label: dto.label ?? field.label,
        key: field.key,
        fieldType: (dto.fieldType ?? field.fieldType) as FieldType,
        options: (dto.options ?? (field.options as any) ?? {}) as Record<
          string,
          any
        >,
        required: dto.required ?? field.required,
      };
      validateFieldDef(merged);

      return tx.customObjectField.update({
        where: { id: fieldId, organizationId: orgId },
        data: {
          ...(dto.label !== undefined && { label: dto.label }),
          ...(dto.fieldType !== undefined && { fieldType: dto.fieldType }),
          ...(dto.options !== undefined && { options: dto.options as any }),
          ...(dto.required !== undefined && { required: dto.required }),
          ...(dto.order !== undefined && { order: dto.order }),
        },
      });
    });
  }

  /**
   * Delete a field AND strip its key from every existing record's jsonb
   * blob in the same transaction. Without the jsonb strip the value would
   * survive as a dangling, unenumerable key.
   */
  async deleteField(orgId: string, objectId: string, fieldId: string) {
    await this.findOne(orgId, objectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      const field = await tx.customObjectField.findFirst({
        where: {
          id: fieldId,
          customObjectId: objectId,
          organizationId: orgId,
        },
      });
      if (!field) throw new NotFoundException('Field not found');

      // Strip the key from every existing record. The `data - 'key'`
      // jsonb operator is the canonical "remove a top-level key" form;
      // we parametrise the key to keep it safe even though we've already
      // validated it via validateFieldKey on insert. Ids are TEXT columns
      // (gen_random_uuid()::text) so no ::uuid cast is needed.
      await tx.$executeRaw`
        UPDATE custom_records
        SET data = data - ${field.key}::text
        WHERE "customObjectId" = ${objectId}
          AND "organizationId" = ${orgId}
      `;

      await tx.customObjectField.delete({
        where: { id: fieldId, organizationId: orgId },
      });
    });
  }

  /**
   * Re-order fields in bulk. Caller sends [{id, order}, ...]; we update
   * each row atomically so the UI never sees an interleaved order.
   */
  async reorderFields(
    orgId: string,
    objectId: string,
    orderMap: Array<{ id: string; order: number }>,
  ) {
    if (!Array.isArray(orderMap)) {
      throw new BadRequestException('orderMap must be an array');
    }
    await this.findOne(orgId, objectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      // Bulk: confirm every id belongs to this object/org BEFORE writing
      // anything, otherwise a malformed payload could partially apply.
      const ids = orderMap.map((m) => m.id);
      const rows = await tx.customObjectField.findMany({
        where: {
          id: { in: ids },
          customObjectId: objectId,
          organizationId: orgId,
        },
        select: { id: true },
      });
      if (rows.length !== orderMap.length) {
        throw new BadRequestException(
          'One or more field ids do not belong to this object.',
        );
      }
      await Promise.all(
        orderMap.map((m) =>
          tx.customObjectField.update({
            where: { id: m.id, organizationId: orgId },
            data: { order: m.order },
          }),
        ),
      );
      return tx.customObjectField.findMany({
        where: { customObjectId: objectId },
        orderBy: { order: 'asc' },
      });
    });
  }

  /**
   * Internal helper — load the field defs for a given object id, in
   * order. Used by custom-records.service to seed the validator.
   */
  async getFieldDefs(orgId: string, objectId: string): Promise<FieldDef[]> {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const rows = await tx.customObjectField.findMany({
        where: { organizationId: orgId, customObjectId: objectId },
        orderBy: { order: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        label: r.label,
        key: r.key,
        fieldType: r.fieldType as FieldType,
        options: (r.options as any) ?? {},
        required: r.required,
        order: r.order,
      }));
    });
  }
}
