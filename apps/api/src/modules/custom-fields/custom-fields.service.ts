import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  ComputedFieldsService,
  ENTITY_RESOURCES,
  evaluateFormula,
  extractFormulaRefs,
  getComputedFieldMeta,
  isKnownEntityType,
  validateLookupConfig,
  validateRollupConfig,
} from './computed-fields.service';

// Custom Fields v2 — the four kinds. "input" is the legacy default.
export type FieldKind = 'input' | 'formula' | 'lookup' | 'rollup';
const FIELD_KINDS: FieldKind[] = ['input', 'formula', 'lookup', 'rollup'];
const COMPUTED_KINDS: FieldKind[] = ['formula', 'lookup', 'rollup'];

export interface CreateCustomFieldDto {
  fieldTo: string;
  name: string;
  fieldType: string; // mapped to schema field `type`
  options?: string[];
  required?: boolean;
  showInList?: boolean;
  showInForm?: boolean;
  order?: number;
  // ── v2 computed fields ──
  fieldKind?: FieldKind;
  formulaExpr?: string | null;
  lookupConfig?: { relation?: string; field?: string } | null;
  rollupConfig?: {
    relation?: string;
    op?: 'sum' | 'count' | 'avg' | 'min' | 'max';
    field?: string;
  } | null;
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
  constructor(
    private prisma: PrismaService,
    private computed: ComputedFieldsService,
  ) {}

  /**
   * Normalize + validate the v2 computed-field config coming off a DTO.
   * Throws BadRequestException on invalid kinds/configs. Returns the
   * persistable column values. For "input" kind, all computed config is
   * nulled out so a field can be safely converted back to input.
   */
  private buildKindData(
    dto: Partial<CreateCustomFieldDto>,
    fieldTo: string | undefined,
  ): {
    fieldKind: FieldKind;
    formulaExpr: string | null;
    lookupConfig: any;
    rollupConfig: any;
  } | null {
    if (dto.fieldKind === undefined) return null; // leave existing values untouched
    const kind = dto.fieldKind;
    if (!FIELD_KINDS.includes(kind)) {
      throw new BadRequestException(`Invalid fieldKind "${kind}"`);
    }

    if (kind === 'input') {
      return { fieldKind: 'input', formulaExpr: null, lookupConfig: null, rollupConfig: null };
    }

    if (kind === 'formula') {
      const expr = (dto.formulaExpr ?? '').trim();
      if (!expr) throw new BadRequestException('Formula fields require a formulaExpr');
      // Validate the expression up front (parse only; throws on bad grammar).
      try {
        extractFormulaRefs(expr);
        // dry-run against an empty scope to surface grammar errors (unknown
        // vars resolve to 0 by rule, so this only catches syntax problems)
        evaluateFormula(expr, {});
      } catch (e: any) {
        throw new BadRequestException(`Invalid formula: ${e?.message ?? 'parse error'}`);
      }
      return { fieldKind: 'formula', formulaExpr: expr, lookupConfig: null, rollupConfig: null };
    }

    if (kind === 'lookup') {
      const cfg = dto.lookupConfig ?? {};
      // Whitelist-validate relation + field against the SAME table the
      // resolver uses, so admins can't persist an unresolvable field.
      if (!fieldTo) {
        throw new BadRequestException('fieldTo is required to validate a lookup field');
      }
      try {
        validateLookupConfig(fieldTo, cfg);
      } catch (e: any) {
        throw new BadRequestException(e?.message ?? 'Invalid lookup config');
      }
      return {
        fieldKind: 'lookup',
        formulaExpr: null,
        lookupConfig: { relation: cfg.relation, field: cfg.field },
        rollupConfig: null,
      };
    }

    // rollup
    const cfg = dto.rollupConfig ?? {};
    if (!fieldTo) {
      throw new BadRequestException('fieldTo is required to validate a rollup field');
    }
    // Whitelist-validate relation ∈ ROLLUP_RELATIONS[fieldTo], op ∈ {sum,
    // count,avg,min,max}, and field ∈ the relation's allowed fields.
    try {
      validateRollupConfig(fieldTo, cfg);
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Invalid rollup config');
    }
    return {
      fieldKind: 'rollup',
      formulaExpr: null,
      lookupConfig: null,
      rollupConfig: {
        relation: cfg.relation,
        op: cfg.op,
        ...(cfg.field ? { field: cfg.field } : {}),
      },
    };
  }

  /**
   * Computed-field option metadata for the admin field-builder UI:
   *   - own (input) field keys usable in a formula for this entity
   *   - the entity's whitelisted own numeric columns
   *   - allowed lookup/rollup relations + their selectable fields + ops
   * Org-scoped: the input field keys come from this org's own custom fields.
   */
  async getComputedMeta(orgId: string, fieldTo: string) {
    const fields = await this.findAll(orgId, fieldTo);
    const inputFieldKeys = (fields as any[])
      .filter((f) => ((f.fieldKind ?? 'input') as FieldKind) === 'input')
      .map((f) => ({ slug: f.slug, name: f.name, type: f.type }));
    const meta = getComputedFieldMeta(fieldTo);
    return {
      ...meta,
      // formula variables = sibling input field slugs + own numeric columns
      formulaVariables: [
        ...inputFieldKeys.map((f) => f.slug),
        ...meta.ownNumericColumns,
      ],
      inputFields: inputFieldKeys,
    };
  }

  /**
   * Validate + preview a formula expression (no persistence). Returns the
   * referenced variable keys, or an error message. Used by the field-builder
   * "this references: [...]" preview. Parse-only — no eval.
   */
  previewFormula(expr: string): { valid: boolean; refs: string[]; error?: string } {
    const trimmed = (expr ?? '').trim();
    if (!trimmed) return { valid: false, refs: [], error: 'empty expression' };
    try {
      const refs = extractFormulaRefs(trimmed);
      evaluateFormula(trimmed, {}); // surfaces grammar errors
      return { valid: true, refs };
    } catch (e: any) {
      return { valid: false, refs: extractFormulaRefs(trimmed), error: e?.message ?? 'parse error' };
    }
  }

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
    // Default to "input" when no kind is provided (legacy behaviour).
    const kindData = this.buildKindData({ fieldKind: 'input', ...dto }, dto.fieldTo);
    const slug = slugify(dto.name);
    // Slug collision guard: two fields with the same name on the same fieldTo
    // slugify identically; setValues() resolves by slug, so a duplicate would
    // silently shadow the other. Reject with 409 (also enforced by the DB
    // unique index on (organizationId, fieldTo, slug)).
    await this.assertSlugAvailable(orgId, dto.fieldTo, slug);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.customField.create({
        data: {
          organizationId: orgId,
          fieldTo: dto.fieldTo,
          name: dto.name,
          slug,
          type: dto.fieldType,
          options: dto.options ?? [],
          required: dto.required ?? false,
          showOnTable: dto.showInList ?? false,
          // NOTE: schema has no `showInForm` column — mapped to `active`
          active: dto.showInForm ?? true,
          order: dto.order ?? 0,
          ...(kindData ?? {}),
        },
      });
    });
  }

  async update(orgId: string, id: string, dto: Partial<CreateCustomFieldDto>) {
    const existing = await this.findOne(orgId, id);
    // The authoritative fieldTo for config validation: the incoming value if
    // changing fieldTo, else the field's current one.
    const effectiveFieldTo = dto.fieldTo ?? (existing as any).fieldTo;
    // Only re-validate/rewrite computed config when fieldKind is supplied.
    const kindData = this.buildKindData(dto, effectiveFieldTo);
    // If name (→ slug) or fieldTo changes, re-check the slug is free.
    if (dto.name !== undefined || dto.fieldTo !== undefined) {
      const newSlug = dto.name !== undefined ? slugify(dto.name) : (existing as any).slug;
      await this.assertSlugAvailable(orgId, effectiveFieldTo, newSlug, id);
    }
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
          ...(kindData ?? {}),
        },
      });
    });
  }

  /**
   * Throw ConflictException if another field on the same (org, fieldTo) already
   * uses this slug. `excludeId` skips the field being updated (self).
   */
  private async assertSlugAvailable(
    orgId: string,
    fieldTo: string,
    slug: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.customField.findFirst({
        where: {
          organizationId: orgId,
          fieldTo,
          slug,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true },
      });
    });
    if (clash) {
      throw new ConflictException(
        `A custom field with slug "${slug}" already exists for "${fieldTo}". ` +
          `Field names must be unique per entity (they map to the same key).`,
      );
    }
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
   * Return list of { field, value, computed? } for a specific entity.
   *
   * Static "input" fields return their stored CustomFieldValue. v2 computed
   * fields (formula / lookup / rollup) are resolved on the fly (READ-ONLY,
   * org-scoped) and returned with `computed: true`. Computed values are never
   * persisted; they are derived every read.
   */
  async getValuesForEntity(
    orgId: string,
    user: any,
    fieldTo: string,
    entityId: string,
  ) {
    // ── ACCESS CONTROL (#1): require <resource>.view for this entity type. ──
    await this.assertEntityPermission(user, fieldTo, 'view');

    // ── TENANT ISOLATION (#2): verify the OWN entity belongs to this org
    // BEFORE any value read / computed resolution. A forged cross-org
    // entityId returns nothing — no values, no child aggregation. This
    // single parent-org check gates every downstream resolver (including
    // rollups over org-less child tables like invoiceItem).
    const ownOk = await this.computed.ownEntityBelongsToOrg(orgId, fieldTo, entityId);
    if (!ownOk) return [];

    const fields = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.customField.findMany({
        where: { organizationId: orgId, fieldTo, active: true },
        orderBy: { order: 'asc' },
      });
    });
    if (fields.length === 0) return [];

    const values = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.customFieldValue.findMany({
        where: {
          organizationId: orgId,
          relType: fieldTo,
          relId: entityId,
          fieldId: { in: fields.map((f: any) => f.id) },
        },
      });
    });

    const valueMap = new Map<string, any>();
    for (const v of values) valueMap.set(v.fieldId, v.value);

    // Sibling scope for formula fields: every NON-computed (input) field's
    // stored value, keyed by slug. Formula fields can only reference these +
    // the entity's own whitelisted numeric columns (resolved in the service).
    const siblingValues: Record<string, string | null> = {};
    for (const f of fields as any[]) {
      const kind = (f.fieldKind ?? 'input') as FieldKind;
      if (kind === 'input') {
        siblingValues[f.slug] = valueMap.get(f.id) ?? null;
      }
    }

    const out: Array<{ field: any; value: any; computed?: boolean; error?: string }> = [];
    for (const field of fields as any[]) {
      const kind = (field.fieldKind ?? 'input') as FieldKind;
      if (!COMPUTED_KINDS.includes(kind)) {
        out.push({ field, value: valueMap.get(field.id) ?? null });
        continue;
      }
      const resolved = await this.computed.resolveComputed(
        orgId,
        fieldTo,
        entityId,
        field,
        siblingValues,
      );
      out.push({
        field,
        value: resolved.value,
        computed: true,
        ...(resolved.error ? { error: resolved.error } : {}),
      });
    }
    return out;
  }

  /**
   * Upsert CustomFieldValue rows. Values keys may be either field slug or id.
   *
   * Computed fields (formula / lookup / rollup) are READ-ONLY: any attempt to
   * set a value on a non-input field is rejected. Computed values are derived
   * on read and never persisted as user input.
   */
  async setValues(
    orgId: string,
    user: any,
    fieldTo: string,
    entityId: string,
    values: Record<string, any>,
  ) {
    // ── ACCESS CONTROL (#1): require <resource>.edit for this entity type. ──
    await this.assertEntityPermission(user, fieldTo, 'edit');

    // ── TENANT ISOLATION (#2): verify the OWN entity belongs to this org
    // before writing any value. A forged cross-org entityId is rejected. ──
    const ownOk = await this.computed.ownEntityBelongsToOrg(orgId, fieldTo, entityId);
    if (!ownOk) throw new NotFoundException(`${fieldTo} not found`);

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

      // Dedup the body by resolved field id (last write wins) BEFORE upserting
      // so two body keys (e.g. slug + id) pointing at the same field can't race
      // on the unique key (fieldId, relId) and trip P2002 (#7).
      const resolved = new Map<string, { field: any; stringValue: string | null }>();
      for (const [key, rawValue] of Object.entries(values)) {
        const field = byId.get(key) ?? bySlug.get(key);
        if (!field) continue;
        // Write-guard: ONLY 'input' fields are writable (default-deny). Any
        // other kind — known computed kinds OR an unexpected value — is
        // read-only (#4). Mirrors the read path's computed resolution.
        const kind = ((field as any).fieldKind ?? 'input') as FieldKind;
        if (kind !== 'input') {
          throw new BadRequestException(
            `Custom field "${field.slug}" is a computed (${kind}) field and is read-only`,
          );
        }
        const stringValue =
          rawValue === null || rawValue === undefined ? null : String(rawValue);
        resolved.set(field.id, { field, stringValue });
      }

      // Run upserts sequentially over the deduped set (no concurrent writes to
      // the same key; small N per entity).
      for (const { field, stringValue } of resolved.values()) {
        await tx.customFieldValue.upsert({
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
        });
      }
      return this.getValuesForEntity(orgId, user, fieldTo, entityId);
    });
  }

  // ── Per-entity RBAC (#1) ─────────────────────────────────────────────────
  //
  // Custom-field VALUE access depends on the entity the value belongs to
  // (reading a client's custom fields needs clients.view, an invoice's needs
  // invoices.view, …) so it can't be expressed with the static @Permissions
  // decorator. Replicate the RbacGuard's resolution — role permissions +
  // per-user overrides, with the same super-admin / portal bypasses — against
  // the dynamically-chosen resource. (Mirrors documents.service assertPermission.)
  private async assertEntityPermission(
    user: any,
    fieldTo: string,
    action: 'view' | 'edit',
  ): Promise<void> {
    if (!isKnownEntityType(fieldTo)) {
      throw new BadRequestException(`Invalid fieldTo "${fieldTo}"`);
    }
    const resource = ENTITY_RESOURCES[fieldTo];
    const permission = `${resource}.${action}`;

    // Super-admins bypass all RBAC; portal contacts handled like RbacGuard.
    if (user?.isAdmin) return;
    if (user?.type === 'contact') return;

    const rolePermissions: Record<string, Record<string, boolean>> =
      user?.role?.permissions || {};
    const [res, act] = permission.split('.');
    const roleHas = rolePermissions?.[res]?.[act] === true;

    let overrideGrant: boolean | undefined;
    if (user?.id) {
      try {
        const override = await (this.prisma as any).userPermissionOverride.findFirst({
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
}
