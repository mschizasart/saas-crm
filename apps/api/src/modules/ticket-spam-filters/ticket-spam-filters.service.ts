import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

// ─── Types ────────────────────────────────────────────────────────────────

export type SpamFilterField = 'subject' | 'fromEmail' | 'body' | 'fromDomain';
export type SpamFilterOperator =
  | 'contains'
  | 'equals'
  | 'startsWith'
  | 'endsWith'
  | 'regex';
export type SpamFilterAction = 'mark_spam' | 'auto_close' | 'reject';

const FIELDS: SpamFilterField[] = [
  'subject',
  'fromEmail',
  'body',
  'fromDomain',
];
const OPERATORS: SpamFilterOperator[] = [
  'contains',
  'equals',
  'startsWith',
  'endsWith',
  'regex',
];
const ACTIONS: SpamFilterAction[] = ['mark_spam', 'auto_close', 'reject'];

export interface CreateSpamFilterDto {
  name: string;
  field: SpamFilterField;
  operator: SpamFilterOperator;
  pattern: string;
  caseSensitive?: boolean;
  action: SpamFilterAction;
  isActive?: boolean;
  priority?: number;
}

export type UpdateSpamFilterDto = Partial<CreateSpamFilterDto>;

export interface TicketDraft {
  subject?: string | null;
  fromEmail?: string | null;
  body?: string | null;
  /** Optional — derived from fromEmail when omitted. */
  fromDomain?: string | null;
}

export interface SpamFilterEvaluation {
  matched: boolean;
  action?: SpamFilterAction;
  filterId?: string;
  filterName?: string;
}

export interface SpamFilterTestMatch {
  id: string;
  name: string;
  field: SpamFilterField;
  operator: SpamFilterOperator;
  action: SpamFilterAction;
  priority: number;
}

// ─── Service ──────────────────────────────────────────────────────────────

@Injectable()
export class TicketSpamFiltersService {
  private readonly logger = new Logger(TicketSpamFiltersService.name);

  /**
   * In-process compiled-regex cache, keyed by filter id. Each entry stores
   * the regex along with the filter's `updatedAt` so we can evict when the
   * rule changes. Process-local — that's fine, this lookup is cheap.
   */
  private readonly regexCache = new Map<
    string,
    { regex: RegExp; updatedAt: number }
  >();

  constructor(private prisma: PrismaService) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────

  async findAll(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      return tx.ticketSpamFilter.findMany({
        where: { organizationId: orgId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      });
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const filter = await tx.ticketSpamFilter.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!filter) throw new NotFoundException('Spam filter not found');
      return filter;
    });
  }

  async create(orgId: string, dto: CreateSpamFilterDto) {
    this.validateDto(dto, true);
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      return tx.ticketSpamFilter.create({
        data: {
          organizationId: orgId,
          name: dto.name.trim(),
          field: dto.field,
          operator: dto.operator,
          pattern: dto.pattern,
          caseSensitive: dto.caseSensitive ?? false,
          action: dto.action,
          isActive: dto.isActive ?? true,
          priority: dto.priority ?? 0,
        },
      });
    });
  }

  async update(orgId: string, id: string, dto: UpdateSpamFilterDto) {
    await this.findOne(orgId, id);
    this.validateDto(dto, false);
    const updated = await this.prisma.withOrganization(
      orgId,
      async (tx: any) => {
        return tx.ticketSpamFilter.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name.trim() }),
            ...(dto.field !== undefined && { field: dto.field }),
            ...(dto.operator !== undefined && { operator: dto.operator }),
            ...(dto.pattern !== undefined && { pattern: dto.pattern }),
            ...(dto.caseSensitive !== undefined && {
              caseSensitive: dto.caseSensitive,
            }),
            ...(dto.action !== undefined && { action: dto.action }),
            ...(dto.isActive !== undefined && { isActive: dto.isActive }),
            ...(dto.priority !== undefined && { priority: dto.priority }),
          },
        });
      },
    );
    // Invalidate any cached compiled regex for this rule.
    this.regexCache.delete(id);
    return updated;
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx: any) => {
      await tx.ticketSpamFilter.delete({ where: { id } });
    });
    this.regexCache.delete(id);
  }

  // ─── Evaluation (used by IMAP processor) ───────────────────────────────

  /**
   * Run all active filters for `orgId` against the ticket draft. Returns
   * the first matching rule (rules ordered by priority ASC then createdAt).
   * Telemetry (matchCount, lastMatchedAt) is bumped on match — fire and
   * forget; failures here must never block ticket creation.
   */
  async evaluate(
    orgId: string,
    draft: TicketDraft,
  ): Promise<SpamFilterEvaluation> {
    let filters: any[] = [];
    try {
      filters = await this.prisma.withOrganization(orgId, async (tx: any) => {
        return tx.ticketSpamFilter.findMany({
          where: { organizationId: orgId, isActive: true },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        });
      });
    } catch (err) {
      this.logger.warn(
        `Failed to load spam filters for org ${orgId}: ${(err as Error).message}`,
      );
      return { matched: false };
    }
    if (filters.length === 0) return { matched: false };

    const fromDomain =
      draft.fromDomain ??
      (draft.fromEmail ? draft.fromEmail.split('@')[1] ?? '' : '');

    const valueByField: Record<SpamFilterField, string> = {
      subject: draft.subject ?? '',
      fromEmail: draft.fromEmail ?? '',
      body: draft.body ?? '',
      fromDomain: fromDomain ?? '',
    };

    for (const filter of filters) {
      const value = valueByField[filter.field as SpamFilterField] ?? '';
      const matched = this.matchesFilter(filter, value);
      if (!matched) continue;

      // Bump telemetry — best effort.
      this.prisma
        .withOrganization(orgId, async (tx: any) =>
          tx.ticketSpamFilter.update({
            where: { id: filter.id },
            data: {
              matchCount: { increment: 1 },
              lastMatchedAt: new Date(),
            },
          }),
        )
        .catch((err) =>
          this.logger.warn(
            `Failed to bump matchCount for filter ${filter.id}: ${(err as Error).message}`,
          ),
        );

      return {
        matched: true,
        action: filter.action as SpamFilterAction,
        filterId: filter.id,
        filterName: filter.name,
      };
    }

    return { matched: false };
  }

  /**
   * Test a draft against rules without bumping telemetry. Returns ALL
   * matching rules (not just the first), so the UI can show every hit
   * even if only the highest-priority one would actually fire.
   */
  async test(
    orgId: string,
    draft: TicketDraft,
  ): Promise<{ matchedFilters: SpamFilterTestMatch[] }> {
    const filters = await this.prisma.withOrganization(
      orgId,
      async (tx: any) => {
        return tx.ticketSpamFilter.findMany({
          where: { organizationId: orgId, isActive: true },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        });
      },
    );

    const fromDomain =
      draft.fromDomain ??
      (draft.fromEmail ? draft.fromEmail.split('@')[1] ?? '' : '');
    const valueByField: Record<SpamFilterField, string> = {
      subject: draft.subject ?? '',
      fromEmail: draft.fromEmail ?? '',
      body: draft.body ?? '',
      fromDomain: fromDomain ?? '',
    };

    const matchedFilters: SpamFilterTestMatch[] = [];
    for (const filter of filters) {
      const value = valueByField[filter.field as SpamFilterField] ?? '';
      if (this.matchesFilter(filter, value)) {
        matchedFilters.push({
          id: filter.id,
          name: filter.name,
          field: filter.field,
          operator: filter.operator,
          action: filter.action,
          priority: filter.priority,
        });
      }
    }
    return { matchedFilters };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private matchesFilter(filter: any, value: string): boolean {
    const cs = !!filter.caseSensitive;
    const haystack = cs ? value : value.toLowerCase();
    const needle = cs ? filter.pattern : String(filter.pattern).toLowerCase();
    switch (filter.operator) {
      case 'contains':
        return haystack.includes(needle);
      case 'equals':
        return haystack === needle;
      case 'startsWith':
        return haystack.startsWith(needle);
      case 'endsWith':
        return haystack.endsWith(needle);
      case 'regex': {
        try {
          const regex = this.getCompiledRegex(filter);
          return regex.test(value);
        } catch {
          // Bad regex on a saved rule — log but don't crash the worker.
          this.logger.warn(
            `Invalid regex on filter ${filter.id} (${filter.name}); skipping`,
          );
          return false;
        }
      }
      default:
        return false;
    }
  }

  private getCompiledRegex(filter: any): RegExp {
    const updatedAt = new Date(filter.updatedAt).getTime();
    const cached = this.regexCache.get(filter.id);
    if (cached && cached.updatedAt === updatedAt) return cached.regex;
    const flags = filter.caseSensitive ? '' : 'i';
    const regex = new RegExp(filter.pattern, flags);
    this.regexCache.set(filter.id, { regex, updatedAt });
    return regex;
  }

  private validateDto(dto: UpdateSpamFilterDto, isCreate: boolean) {
    if (isCreate) {
      if (!dto.name || !dto.name.trim())
        throw new BadRequestException('name is required');
      if (!dto.field) throw new BadRequestException('field is required');
      if (!dto.operator) throw new BadRequestException('operator is required');
      if (dto.pattern === undefined || dto.pattern === null || dto.pattern === '')
        throw new BadRequestException('pattern is required');
      if (!dto.action) throw new BadRequestException('action is required');
    }
    if (dto.field !== undefined && !FIELDS.includes(dto.field)) {
      throw new BadRequestException(
        `field must be one of: ${FIELDS.join(', ')}`,
      );
    }
    if (dto.operator !== undefined && !OPERATORS.includes(dto.operator)) {
      throw new BadRequestException(
        `operator must be one of: ${OPERATORS.join(', ')}`,
      );
    }
    if (dto.action !== undefined && !ACTIONS.includes(dto.action)) {
      throw new BadRequestException(
        `action must be one of: ${ACTIONS.join(', ')}`,
      );
    }
    if (
      dto.operator === 'regex' &&
      dto.pattern !== undefined &&
      dto.pattern !== null &&
      dto.pattern !== ''
    ) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(dto.pattern);
      } catch (err) {
        throw new BadRequestException(
          `Invalid regex: ${(err as Error).message}`,
        );
      }
    }
    if (
      dto.priority !== undefined &&
      (typeof dto.priority !== 'number' || !Number.isFinite(dto.priority))
    ) {
      throw new BadRequestException('priority must be a finite number');
    }
  }
}
