import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { TicketSpamFiltersService } from './ticket-spam-filters.service';
import { PrismaService } from '../../database/prisma.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('TicketSpamFiltersService', () => {
  let service: TicketSpamFiltersService;
  let prisma: DeepMocked<PrismaService>;

  const ORG_ID = 'org_t';

  // Helper: build a TicketSpamFilter row
  const makeFilter = (overrides: any = {}) => ({
    id: overrides.id ?? 'f1',
    organizationId: ORG_ID,
    name: overrides.name ?? 'rule',
    field: overrides.field ?? 'subject',
    operator: overrides.operator ?? 'contains',
    pattern: overrides.pattern ?? 'spam',
    caseSensitive: overrides.caseSensitive ?? false,
    action: overrides.action ?? 'mark_spam',
    isActive: overrides.isActive ?? true,
    priority: overrides.priority ?? 0,
    matchCount: 0,
    lastMatchedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  });

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    // The bg telemetry update can fail silently — make it a no-op by default.
    (prisma.ticketSpamFilter.update as jest.Mock).mockResolvedValue({});
    service = new TicketSpamFiltersService(prisma);
  });

  // ─── evaluate ────────────────────────────────────────────────
  describe('evaluate (first-match-wins)', () => {
    it('returns matched=false when no filters exist', async () => {
      (prisma.ticketSpamFilter.findMany as jest.Mock).mockResolvedValue([]);
      const r = await service.evaluate(ORG_ID, {
        subject: 'hi',
        fromEmail: 'a@a.com',
      });
      expect(r.matched).toBe(false);
    });

    it('returns matched=true on first matching rule and stops', async () => {
      (prisma.ticketSpamFilter.findMany as jest.Mock).mockResolvedValue([
        makeFilter({ id: 'f1', priority: 0, pattern: 'lottery', action: 'reject' }),
        makeFilter({ id: 'f2', priority: 1, pattern: 'spam', action: 'mark_spam' }),
      ]);

      const r = await service.evaluate(ORG_ID, {
        subject: 'You won the lottery and a spam prize',
        fromEmail: '',
      });
      expect(r).toMatchObject({
        matched: true,
        action: 'reject',
        filterId: 'f1',
      });
    });

    it('domain rule matches against the from-email host portion', async () => {
      (prisma.ticketSpamFilter.findMany as jest.Mock).mockResolvedValue([
        makeFilter({
          id: 'f-domain',
          field: 'fromDomain',
          operator: 'equals',
          pattern: 'evil.com',
        }),
      ]);
      const r = await service.evaluate(ORG_ID, {
        subject: 'whatever',
        fromEmail: 'attacker@evil.com',
      });
      expect(r.matched).toBe(true);
    });

    it('case-sensitive flag toggles matching', async () => {
      (prisma.ticketSpamFilter.findMany as jest.Mock).mockResolvedValue([
        makeFilter({
          field: 'subject',
          operator: 'equals',
          pattern: 'SPAM',
          caseSensitive: true,
        }),
      ]);
      const r = await service.evaluate(ORG_ID, {
        subject: 'spam',
        fromEmail: '',
      });
      expect(r.matched).toBe(false);
    });

    it('survives a malformed regex on a saved rule (logs but doesn\'t throw)', async () => {
      (prisma.ticketSpamFilter.findMany as jest.Mock).mockResolvedValue([
        makeFilter({ operator: 'regex', pattern: '[unterminated' }),
      ]);
      const r = await service.evaluate(ORG_ID, {
        subject: 'whatever',
        fromEmail: '',
      });
      expect(r.matched).toBe(false);
    });
  });

  // ─── regex cache ─────────────────────────────────────────────
  describe('regex compilation cache', () => {
    it('caches compiled regex per filter id', async () => {
      const filter = makeFilter({
        id: 'rx',
        operator: 'regex',
        pattern: '^viagra',
      });
      (prisma.ticketSpamFilter.findMany as jest.Mock).mockResolvedValue([filter]);

      await service.evaluate(ORG_ID, { subject: 'viagra now' });
      await service.evaluate(ORG_ID, { subject: 'viagra forever' });

      // Internal map should have one entry
      const cacheSize = ((service as any).regexCache as Map<string, any>).size;
      expect(cacheSize).toBe(1);
    });

    it('update() invalidates the cache', async () => {
      const filter = makeFilter({
        id: 'rx2',
        operator: 'regex',
        pattern: '^foo',
      });
      // Prime the cache
      (prisma.ticketSpamFilter.findMany as jest.Mock).mockResolvedValue([filter]);
      await service.evaluate(ORG_ID, { subject: 'foo bar' });
      expect(((service as any).regexCache as Map<string, any>).has('rx2')).toBe(
        true,
      );

      // Now update
      (prisma.ticketSpamFilter.findFirst as jest.Mock).mockResolvedValue(filter);
      (prisma.ticketSpamFilter.update as jest.Mock).mockResolvedValue({
        ...filter,
        pattern: '^bar',
        updatedAt: new Date('2025-02-01'),
      });

      await service.update(ORG_ID, 'rx2', { pattern: '^bar' });
      expect(
        ((service as any).regexCache as Map<string, any>).has('rx2'),
      ).toBe(false);
    });
  });

  // ─── test() ──────────────────────────────────────────────────
  describe('test()', () => {
    it('returns ALL matching rules (not just first-match)', async () => {
      (prisma.ticketSpamFilter.findMany as jest.Mock).mockResolvedValue([
        makeFilter({ id: 'a', priority: 0, pattern: 'spam' }),
        makeFilter({ id: 'b', priority: 1, pattern: 'lottery' }),
        makeFilter({ id: 'c', priority: 2, pattern: 'unrelated' }),
      ]);

      const r = await service.test(ORG_ID, {
        subject: 'spam lottery email',
        fromEmail: '',
      });

      expect(r.matchedFilters.map((f) => f.id)).toEqual(['a', 'b']);
    });

    it('does NOT bump matchCount (no telemetry side-effects)', async () => {
      (prisma.ticketSpamFilter.findMany as jest.Mock).mockResolvedValue([
        makeFilter({ id: 'x', pattern: 'foo' }),
      ]);

      // Reset calls & call test
      (prisma.ticketSpamFilter.update as jest.Mock).mockClear();
      await service.test(ORG_ID, { subject: 'foo bar' });

      expect(prisma.ticketSpamFilter.update).not.toHaveBeenCalled();
    });
  });

  // ─── validation in create ────────────────────────────────────
  describe('create validation', () => {
    it('rejects an empty name', async () => {
      await expect(
        service.create(ORG_ID, {
          name: '',
          field: 'subject',
          operator: 'contains',
          pattern: 'x',
          action: 'mark_spam',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects bad regex on regex operator', async () => {
      await expect(
        service.create(ORG_ID, {
          name: 'rx',
          field: 'subject',
          operator: 'regex',
          pattern: '[invalid',
          action: 'mark_spam',
        }),
      ).rejects.toThrow(/Invalid regex/);
    });
  });

  // ─── findOne ─────────────────────────────────────────────────
  describe('findOne', () => {
    it('throws NotFound when filter is missing', async () => {
      (prisma.ticketSpamFilter.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne(ORG_ID, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
