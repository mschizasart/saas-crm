import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  evaluateRule,
  RuleCondition,
  VALIDATION_OPERATORS,
} from './condition-evaluator';

export interface CreateValidationRuleDto {
  fieldTo: string;
  name: string;
  description?: string;
  conditionLogic?: string; // 'AND' | 'OR'
  conditions: RuleCondition[];
  errorMessage: string;
  active?: boolean;
  order?: number;
}

export interface UpdateValidationRuleDto {
  fieldTo?: string;
  name?: string;
  description?: string;
  conditionLogic?: string;
  conditions?: RuleCondition[];
  errorMessage?: string;
  active?: boolean;
  order?: number;
}

export interface TestValidationRuleDto {
  fieldTo: string;
  conditionLogic?: string;
  conditions: RuleCondition[];
  sampleRecord: Record<string, any>;
}

/** Minimal Prisma transaction-client surface this service uses. */
type TxLike = {
  validationRule: any;
  customField: any;
  customFieldValue: any;
};

@Injectable()
export class ValidationRulesService {
  constructor(private prisma: PrismaService) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async findAll(orgId: string, fieldTo?: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.validationRule.findMany({
        where: {
          organizationId: orgId,
          ...(fieldTo ? { fieldTo } : {}),
        },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      });
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const rule = await tx.validationRule.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!rule) throw new NotFoundException('Validation rule not found');
      return rule;
    });
  }

  async create(orgId: string, dto: CreateValidationRuleDto) {
    this.assertConditionsValid(dto.conditions);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.validationRule.create({
        data: {
          organizationId: orgId,
          fieldTo: dto.fieldTo,
          name: dto.name,
          description: dto.description ?? null,
          conditionLogic: this.normalizeLogic(dto.conditionLogic),
          conditions: (dto.conditions ?? []) as any,
          errorMessage: dto.errorMessage,
          active: dto.active ?? true,
          order: dto.order ?? 0,
        },
      });
    });
  }

  async update(orgId: string, id: string, dto: UpdateValidationRuleDto) {
    await this.findOne(orgId, id);
    if (dto.conditions !== undefined) this.assertConditionsValid(dto.conditions);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.validationRule.update({
        where: { id },
        data: {
          ...(dto.fieldTo !== undefined && { fieldTo: dto.fieldTo }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.conditionLogic !== undefined && {
            conditionLogic: this.normalizeLogic(dto.conditionLogic),
          }),
          ...(dto.conditions !== undefined && {
            conditions: dto.conditions as any,
          }),
          ...(dto.errorMessage !== undefined && {
            errorMessage: dto.errorMessage,
          }),
          ...(dto.active !== undefined && { active: dto.active }),
          ...(dto.order !== undefined && { order: dto.order }),
        },
      });
    });
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.validationRule.delete({ where: { id } });
    });
  }

  // ─── Dry-run (UI builder helper) ────────────────────────────────────────────

  /**
   * Evaluate an UNSAVED rule against a sample record without persisting it.
   * `sampleRecord` may carry a `__customFields` map for cf:<slug> refs; if it
   * instead carries plain `cf_<slug>`-style keys, the UI should map them.
   */
  test(dto: TestValidationRuleDto): { violated: boolean } {
    const violated = evaluateRule(
      {
        conditionLogic: this.normalizeLogic(dto.conditionLogic),
        conditions: dto.conditions ?? [],
      },
      dto.sampleRecord ?? {},
    );
    return { violated };
  }

  // ─── Save-time enforcement ──────────────────────────────────────────────────

  /**
   * Evaluate every ACTIVE rule for (orgId, fieldTo) against `record`. Collect
   * the errorMessage of every rule that is VIOLATED (condition matches) and, if
   * any, throw a BadRequestException with a structured payload so the caller /
   * UI can surface all messages at once.
   *
   * @param tx                 Optional Prisma tx — when provided the rules are
   *                           read inside the SAME transaction as the pending
   *                           write so a throw aborts it atomically.
   * @param customFieldValues  slug -> value map for cf:<slug> condition refs.
   */
  async assertValid(
    orgId: string,
    fieldTo: string,
    record: Record<string, any>,
    tx?: TxLike,
    customFieldValues?: Record<string, any> | null,
  ): Promise<void> {
    const load = async (t: TxLike) =>
      t.validationRule.findMany({
        where: { organizationId: orgId, fieldTo, active: true },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      });

    const rules = tx
      ? await load(tx)
      : await this.prisma.withOrganization(orgId, async (t) =>
          load(t as unknown as TxLike),
        );

    if (!rules || rules.length === 0) return;

    const evalRecord = { ...record, __customFields: customFieldValues ?? null };

    const errors: string[] = [];
    for (const rule of rules) {
      if (evaluateRule(rule, evalRecord)) {
        errors.push(rule.errorMessage);
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors,
      });
    }
  }

  /**
   * Load the existing custom-field values for a saved entity as a slug -> value
   * map. Used on UPDATE so cf:<slug> conditions can evaluate against the merged
   * (existing + incoming) record. Reads inside the supplied tx when given.
   */
  async loadCustomFieldValues(
    orgId: string,
    fieldTo: string,
    entityId: string,
    tx?: TxLike,
  ): Promise<Record<string, any>> {
    const load = async (t: TxLike) => {
      const fields = await t.customField.findMany({
        where: { organizationId: orgId, fieldTo },
        select: { id: true, slug: true },
      });
      if (!fields.length) return {} as Record<string, any>;
      const values = await t.customFieldValue.findMany({
        where: {
          organizationId: orgId,
          relType: fieldTo,
          relId: entityId,
          fieldId: { in: fields.map((f: any) => f.id) },
        },
        select: { fieldId: true, value: true },
      });
      const bySlug = new Map<string, string>(
        fields.map((f: any) => [f.id, f.slug]),
      );
      const out: Record<string, any> = {};
      for (const v of values) {
        const slug = bySlug.get(v.fieldId);
        if (slug) out[slug] = v.value;
      }
      return out;
    };

    return tx
      ? load(tx)
      : this.prisma.withOrganization(orgId, async (t) =>
          load(t as unknown as TxLike),
        );
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  private normalizeLogic(logic?: string): string {
    return String(logic ?? 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND';
  }

  private assertConditionsValid(conditions: RuleCondition[] | undefined): void {
    if (!Array.isArray(conditions) || conditions.length === 0) {
      throw new BadRequestException('At least one condition is required');
    }
    for (const c of conditions) {
      if (!c || typeof c.field !== 'string' || c.field.trim() === '') {
        throw new BadRequestException('Each condition requires a non-empty field');
      }
      if (
        typeof c.operator !== 'string' ||
        !(VALIDATION_OPERATORS as readonly string[]).includes(c.operator)
      ) {
        throw new BadRequestException(
          `Invalid operator "${c?.operator}". Allowed: ${VALIDATION_OPERATORS.join(', ')}`,
        );
      }
    }
  }
}
