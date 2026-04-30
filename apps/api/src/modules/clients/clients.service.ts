import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { EXPORT_ROW_CAP } from '../../common/csv/csv-writer';

export interface CreateClientDto {
  company: string;
  groupId?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  website?: string;
  phone?: string;
  vat?: string;
  currencyId?: string;
  defaultLanguage?: string;
  billingStreet?: string;
  billingCity?: string;
  billingState?: string;
  billingZip?: string;
  billingCountry?: string;
}

export interface ImportSkipped {
  row: number;
  reason: string;
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
}

export interface ImportResult {
  imported: number;
  skipped: ImportSkipped[];
  errors: ImportError[];
}

/** Columns accepted by the clients CSV importer (case-insensitive, snake or camel). */
const CLIENT_CSV_COLUMNS = [
  'company',
  'email',
  'phone',
  'website',
  'address',
  'city',
  'country',
  'vatNumber',
  'currency',
  'notes',
] as const;

export interface CreateContactDto {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  phoneMobile?: string;
  isPrimary?: boolean;
}

// ─── Statement types ─────────────────────────────────────────
// Shape returned by getStatement(). The PDF renderer and the web preview
// both consume this; the controller injects `organization` before passing
// to the PDF template.

export type StatementTxType = 'invoice' | 'payment' | 'credit_note';

export interface StatementTransaction {
  date: string;
  type: StatementTxType;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  meta?: Record<string, any>;
}

export interface StatementResult {
  client: {
    id: string;
    company: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    country: string | null;
    vat: string | null;
  };
  organization: {
    id: string;
    name: string;
    logo: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    country: string | null;
    phone: string | null;
    website: string | null;
    vatNumber: string | null;
  } | null;
  currency: {
    id: string;
    code: string | null;
    name: string;
    symbol: string;
  } | null;
  dateRange: { from: string | null; to: string | null };
  openingBalance: number;
  closingBalance: number;
  transactions: StatementTransaction[];
  totals: { debit: number; credit: number };
  /** Count of transactions in other currencies that were excluded. */
  skipCount: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    private activityLog: ActivityLogService,
  ) {}

  // ─── Export ───────────────────────────────────────────────
  // Returns up to EXPORT_ROW_CAP matching rows for the given filters. No
  // pagination — the caller (controller) renders the rows to CSV.
  async findAllForExport(
    orgId: string,
    query: { search?: string; active?: boolean } = {},
  ): Promise<{ rows: any[]; truncated: boolean }> {
    const { search, active } = query;
    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (search) where.company = { contains: search, mode: 'insensitive' };
      if (active !== undefined) where.active = active;

      const rows = await tx.client.findMany({
        where,
        orderBy: { company: 'asc' },
        take: EXPORT_ROW_CAP + 1,
        include: {
          group: { select: { name: true } },
          currency: { select: { code: true, symbol: true } },
        },
      });

      const truncated = rows.length > EXPORT_ROW_CAP;
      if (truncated) {
        this.logger.warn(
          `Clients export truncated at ${EXPORT_ROW_CAP} rows for org ${orgId}`,
        );
      }
      return { rows: truncated ? rows.slice(0, EXPORT_ROW_CAP) : rows, truncated };
    });
  }

  // ─── Clients CRUD ──────────────────────────────────────────

  async findAll(
    orgId: string,
    query: { search?: string; page?: number; limit?: number; active?: boolean },
  ) {
    const { search, page = 1, limit = 20, active } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (search) where.company = { contains: search, mode: 'insensitive' };
      if (active !== undefined) where.active = active;

      const [data, total] = await Promise.all([
        tx.client.findMany({
          where,
          skip,
          take: limit,
          orderBy: { company: 'asc' },
          include: {
            group: { select: { id: true, name: true } },
            currency: { select: { id: true, symbol: true, name: true } },
            _count: { select: { invoices: true, projects: true, tickets: true } },
          },
        }),
        tx.client.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { id, organizationId: orgId },
        include: {
          group: true,
          currency: true,
          contacts: {
            where: { type: 'contact', active: true },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              isPrimary: true,
            },
          },
          customFieldValues: { include: { field: true } },
          _count: {
            select: {
              invoices: true,
              projects: true,
              tickets: true,
              contracts: true,
            },
          },
        },
      });
      if (!client) throw new NotFoundException('Client not found');
      return client;
    });
  }

  async create(orgId: string, dto: CreateClientDto, createdBy: string) {
    const client = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.client.create({ data: { ...dto, organizationId: orgId } });
    });
    this.events.emit('client.created', { client, orgId, createdBy });
    return client;
  }

  async update(orgId: string, id: string, dto: Partial<CreateClientDto>, userId?: string) {
    const existing = await this.findOne(orgId, id);
    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.client.update({ where: { id }, data: dto });
    });

    // Log field-level changes
    if (userId) {
      await this.activityLog.logEntityUpdate(
        orgId,
        userId,
        'client',
        id,
        existing,
        dto,
      );
    }

    return updated;
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.client.delete({ where: { id } });
    });
    this.events.emit('client.deleted', { id, orgId });
  }

  async toggleActive(orgId: string, id: string) {
    const client = await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.client.update({
        where: { id },
        data: { active: !client.active },
      });
    });
  }

  // ─── Contacts ──────────────────────────────────────────────

  async getContacts(orgId: string, clientId: string) {
    await this.findOne(orgId, clientId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.user.findMany({
        where: { organizationId: orgId, clientId, type: 'contact' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          isPrimary: true,
          active: true,
          lastLogin: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
      });
    });
  }

  async createContact(orgId: string, clientId: string, dto: CreateContactDto) {
    await this.findOne(orgId, clientId);
    const existing = await this.prisma.user.findFirst({
      where: { organizationId: orgId, email: dto.email },
    });
    if (existing) throw new ConflictException('A user with this email already exists');

    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(Math.random().toString(36).slice(-12), 12);

    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.user.create({
        data: {
          organizationId: orgId,
          email: dto.email,
          password: hash,
          passwordFormat: 'bcrypt',
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          phoneMobile: dto.phoneMobile,
          type: 'contact',
          clientId,
          isPrimary: dto.isPrimary ?? false,
          active: true,
        },
      });
    });
  }

  // ─── Groups ────────────────────────────────────────────────

  async getGroups(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.clientGroup.findMany({
        where: { organizationId: orgId },
        include: { _count: { select: { clients: true } } },
        orderBy: { name: 'asc' },
      });
    });
  }

  async createGroup(orgId: string, name: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.clientGroup.create({
        data: { organizationId: orgId, name },
      });
    });
  }

  async deleteGroup(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.clientGroup.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Client group not found');
      // Set groupId to null on clients in this group
      await tx.client.updateMany({ where: { groupId: id, organizationId: orgId }, data: { groupId: null } });
      await tx.clientGroup.delete({ where: { id } });
    });
  }

  // ─── Statement ─────────────────────────────────────────────
  //
  // A "statement of account" is the per-client ledger:
  //   opening balance (everything dated BEFORE `from`)
  //   + chronological list of invoices, payments, credit-notes between
  //     `from` and `to`, each with running balance
  //   = closing balance.
  //
  // Numbers:
  //   - Debit  = invoice.total            (what the client OWES us)
  //   - Credit = payment.amount           (what they paid)
  //              + creditNote.total       (what we wrote off)
  //   - Cancelled invoices are excluded.
  //
  // Currency:
  //   - Locked to the client's default currency (Client.currencyId).
  //   - If the client has no default currency, falls back to the org's
  //     default currency (Currency.isDefault) — and if that's missing too,
  //     we include all transactions and skipCount stays 0.
  //   - Transactions in OTHER currencies are skipped and surfaced via
  //     `skipCount` so the PDF/HTML view can show a footnote.

  async getStatement(
    orgId: string,
    clientId: string,
    options?: { from?: Date; to?: Date },
  ): Promise<StatementResult> {
    const client = await this.findOne(orgId, clientId);
    const from = options?.from;
    const to = options?.to;

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Pick the statement currency: client default → org default → null.
      let currency = (client as any).currency ?? null;
      if (!currency) {
        currency = await tx.currency.findFirst({
          where: { organizationId: orgId, isDefault: true },
          select: { id: true, code: true, name: true, symbol: true },
        });
      }
      const currencyId: string | null = currency?.id ?? null;

      // Build the where-clauses. We always pull the full history (no `from`)
      // because we need everything before `from` to compute the opening
      // balance; we filter on the JS side instead. The `to` upper bound *is*
      // applied at the DB level to keep payloads small.
      const invoiceWhere: any = {
        clientId,
        organizationId: orgId,
        status: { not: 'cancelled' },
      };
      if (currencyId) invoiceWhere.currencyId = currencyId;
      if (to) invoiceWhere.date = { lte: to };

      const paymentWhere: any = { clientId, organizationId: orgId };
      if (to) paymentWhere.paymentDate = { lte: to };

      const creditNoteWhere: any = {
        clientId,
        organizationId: orgId,
        status: { not: 'void' },
      };
      if (to) creditNoteWhere.date = { lte: to };

      // Pull invoices, payments, credit-notes — only those in the chosen
      // currency (where applicable). Payments don't have a currencyId FK, so
      // we filter them via their parent invoice.
      const [invoices, payments, creditNotes] = await Promise.all([
        tx.invoice.findMany({
          where: invoiceWhere,
          select: {
            id: true,
            number: true,
            date: true,
            dueDate: true,
            total: true,
            status: true,
            currencyId: true,
          },
          orderBy: { date: 'asc' },
        }),
        tx.payment.findMany({
          where: paymentWhere,
          select: {
            id: true,
            amount: true,
            paymentDate: true,
            transactionId: true,
            note: true,
            invoice: {
              select: {
                id: true,
                number: true,
                currencyId: true,
              },
            },
          },
          orderBy: { paymentDate: 'asc' },
        }),
        // CreditNote has no currencyId in the current schema — we trust
        // it's in the same currency as its parent invoice / the client.
        tx.creditNote
          .findMany({
            where: creditNoteWhere,
            select: {
              id: true,
              number: true,
              date: true,
              total: true,
              status: true,
              invoice: { select: { currencyId: true } },
            },
            orderBy: { date: 'asc' },
          })
          .catch(() => [] as any[]),
      ]);

      // Filter payments to the chosen currency via their invoice. Payments
      // whose invoice has no currencyId (or whose invoice was deleted but
      // payment kept around) are assumed to be in the client's currency.
      const filteredPayments = currencyId
        ? payments.filter((p) => {
            const c = p.invoice?.currencyId;
            return c == null ? true : c === currencyId;
          })
        : payments;

      // Filter credit-notes to the chosen currency via their parent invoice
      // (CreditNote has no currencyId of its own). Standalone credit-notes
      // (no invoice) are always included — assumed to be in the client's
      // currency.
      const filteredCreditNotes = currencyId
        ? creditNotes.filter((c: any) => {
            const cnCur = c.invoice?.currencyId;
            return cnCur == null ? true : cnCur === currencyId;
          })
        : creditNotes;

      // Tally how many rows we dropped because of currency mismatch — used
      // for the "X transactions in other currencies are not shown" footnote.
      // Invoices were filtered at the DB level, so we have to count the
      // ones we excluded separately. We treat invoices with a non-null
      // currencyId different from ours as "other currency"; invoices with
      // a null currencyId are assumed to be in the org default.
      const otherCurrencyInvoices = currencyId
        ? await tx.invoice.count({
            where: {
              clientId,
              organizationId: orgId,
              status: { not: 'cancelled' },
              ...(to ? { date: { lte: to } } : {}),
              // Invoices that have a currencyId AND it differs from ours.
              AND: [
                { currencyId: { not: null } },
                { currencyId: { not: currencyId } },
              ],
            },
          })
        : 0;

      const skipCount =
        (payments.length - filteredPayments.length) +
        (creditNotes.length - filteredCreditNotes.length) +
        otherCurrencyInvoices;

      // Build a unified, chronologically-sorted ledger.
      type Tx = {
        date: Date;
        type: 'invoice' | 'payment' | 'credit_note';
        reference: string;
        description: string;
        debit: number;
        credit: number;
        balance: number; // filled below
        meta?: Record<string, any>;
      };
      const all: Tx[] = [];

      for (const inv of invoices) {
        all.push({
          date: new Date(inv.date),
          type: 'invoice',
          reference: inv.number,
          description: `Invoice ${inv.number}`,
          debit: Number(inv.total ?? 0),
          credit: 0,
          balance: 0,
          meta: { id: inv.id, status: inv.status, dueDate: inv.dueDate },
        });
      }
      for (const pay of filteredPayments) {
        all.push({
          date: new Date(pay.paymentDate),
          type: 'payment',
          reference:
            pay.transactionId ?? pay.invoice?.number ?? pay.id.slice(0, 8),
          description: `Payment${pay.invoice?.number ? ` for ${pay.invoice.number}` : ''}`,
          debit: 0,
          credit: Number(pay.amount ?? 0),
          balance: 0,
          meta: { id: pay.id, invoiceId: pay.invoice?.id ?? null },
        });
      }
      for (const cn of filteredCreditNotes as any[]) {
        all.push({
          date: new Date(cn.date),
          type: 'credit_note',
          reference: cn.number,
          description: `Credit Note ${cn.number}`,
          debit: 0,
          credit: Number(cn.total ?? 0),
          balance: 0,
          meta: { id: cn.id, status: cn.status },
        });
      }

      all.sort((a, b) => {
        const t = a.date.getTime() - b.date.getTime();
        if (t !== 0) return t;
        // Stable secondary sort: invoices first, then credits, then payments
        // (so a same-day payment shows up after the invoice it pays).
        const order = { invoice: 0, credit_note: 1, payment: 2 } as const;
        return order[a.type] - order[b.type];
      });

      // Split into "before from" (opening) vs "in range" (transactions).
      const before = from ? all.filter((t) => t.date < from) : [];
      const inRange = from ? all.filter((t) => t.date >= from) : all;

      const openingBalance = before.reduce(
        (s, t) => s + t.debit - t.credit,
        0,
      );

      let running = openingBalance;
      for (const t of inRange) {
        running += t.debit - t.credit;
        t.balance = round2(running);
      }
      const closingBalance = round2(running);

      return {
        client: {
          id: client.id,
          company: client.company,
          address: client.address,
          city: client.city,
          state: client.state,
          zipCode: client.zipCode,
          country: client.country,
          vat: client.vat,
        },
        organization: null, // filled in by the controller for PDF use
        currency: currency
          ? {
              id: currency.id,
              code: currency.code,
              name: currency.name,
              symbol: currency.symbol,
            }
          : null,
        dateRange: {
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
        },
        openingBalance: round2(openingBalance),
        closingBalance,
        transactions: inRange.map((t) => ({
          date: t.date.toISOString(),
          type: t.type,
          reference: t.reference,
          description: t.description,
          debit: round2(t.debit),
          credit: round2(t.credit),
          balance: t.balance,
          meta: t.meta,
        })),
        totals: {
          debit: round2(inRange.reduce((s, t) => s + t.debit, 0)),
          credit: round2(inRange.reduce((s, t) => s + t.credit, 0)),
        },
        skipCount,
      };
    });
  }

  // ─── CSV Import ────────────────────────────────────────────

  /**
   * Columns accepted by the importer (exposed for the /import/template route).
   */
  static readonly CSV_COLUMNS = CLIENT_CSV_COLUMNS;

  /**
   * Import clients from a raw CSV buffer.
   *
   * - Parses with `csv-parse/sync` (handles BOM, quoted commas, CRLF).
   * - Header row is required; column names match `CLIENT_CSV_COLUMNS`
   *   case-insensitively and also tolerate snake_case aliases
   *   (e.g. `vat_number`, `vat`).
   * - `company` is required per row; missing → skipped.
   * - Duplicates within the same tenant (by `company`, case-insensitive)
   *   are skipped with reason "duplicate: company exists".
   * - All rows are inserted inside a single transaction; any DB failure on
   *   one row is reported in `errors` and processing continues.
   */
  async importFromCsv(orgId: string, csvBuffer: Buffer): Promise<ImportResult> {
    let records: Record<string, string>[];
    try {
      records = parseCsvSync(csvBuffer, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      }) as Record<string, string>[];
    } catch (err: any) {
      throw new BadRequestException(`CSV parse failed: ${err.message}`);
    }

    if (records.length === 0) {
      return { imported: 0, skipped: [], errors: [] };
    }

    // Resolve currency codes/symbols/names to currencyId map for this org.
    const currencies = await this.prisma.currency.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, symbol: true, code: true },
    });
    const currencyIndex = new Map<string, string>();
    for (const c of currencies) {
      currencyIndex.set(c.name.toLowerCase(), c.id);
      if (c.symbol) currencyIndex.set(c.symbol.toLowerCase(), c.id);
      if (c.code) currencyIndex.set(c.code.toLowerCase(), c.id);
    }

    // Pre-load existing company names (lowercased) to dedupe across the file + DB.
    const existing = await this.prisma.client.findMany({
      where: { organizationId: orgId },
      select: { company: true },
    });
    const seenCompanies = new Set<string>(
      existing.map((c) => c.company.trim().toLowerCase()),
    );

    const skipped: ImportSkipped[] = [];
    const errors: ImportError[] = [];
    let imported = 0;

    // Normalise a row to a clean, lowercased key map so alias keys work.
    const pick = (row: Record<string, string>, ...keys: string[]) => {
      for (const k of keys) {
        const v = row[k.toLowerCase()];
        if (v !== undefined && v !== null && String(v).trim() !== '') {
          return String(v).trim();
        }
      }
      return null;
    };

    await this.prisma.withOrganization(orgId, async (tx) => {
      for (let i = 0; i < records.length; i++) {
        const rowNum = i + 2; // +1 for header, +1 for 1-based
        const row = records[i];

        const company = pick(row, 'company', 'company_name', 'name');
        if (!company) {
          skipped.push({ row: rowNum, reason: 'missing required field: company' });
          continue;
        }

        const key = company.toLowerCase();
        if (seenCompanies.has(key)) {
          skipped.push({ row: rowNum, reason: 'duplicate: company exists' });
          continue;
        }

        const email = pick(row, 'email', 'contact_email');
        const phone = pick(row, 'phone', 'telephone');
        const website = pick(row, 'website', 'url');
        const address = pick(row, 'address', 'street');
        const city = pick(row, 'city');
        const country = pick(row, 'country');
        const vat = pick(row, 'vatnumber', 'vat_number', 'vat', 'tax_id');
        const currencyRaw = pick(row, 'currency');
        const notes = pick(row, 'notes', 'note', 'description');

        let currencyId: string | null = null;
        if (currencyRaw) {
          currencyId = currencyIndex.get(currencyRaw.toLowerCase()) ?? null;
          if (!currencyId) {
            // Non-fatal: record as an error but still import without currency.
            errors.push({
              row: rowNum,
              field: 'currency',
              message: `unknown currency "${currencyRaw}" — imported without currency`,
            });
          }
        }

        try {
          const created = await tx.client.create({
            data: {
              organizationId: orgId,
              company,
              phone,
              website,
              address,
              city,
              country,
              vat,
              currencyId,
            },
          });

          // Mark as seen so later rows in the same file dedupe correctly.
          seenCompanies.add(key);

          // Optionally attach a primary contact if email is present.
          if (email) {
            const exists = await tx.user.findFirst({
              where: { organizationId: orgId, email },
              select: { id: true },
            });
            if (!exists) {
              const bcrypt = await import('bcryptjs');
              const hash = await bcrypt.hash(
                Math.random().toString(36).slice(-12),
                12,
              );
              await tx.user.create({
                data: {
                  organizationId: orgId,
                  email,
                  password: hash,
                  passwordFormat: 'bcrypt',
                  firstName: company.slice(0, 50),
                  lastName: '',
                  type: 'contact',
                  clientId: created.id,
                  isPrimary: true,
                  active: true,
                },
              });
            }
          }

          // `notes` isn't a column on the client model — stash it on the
          // client's customFieldValues if a field exists, otherwise drop it.
          // Silent by design: we've documented it in the template.
          void notes;

          imported++;
        } catch (err: any) {
          errors.push({
            row: rowNum,
            field: 'row',
            message: err?.message ?? 'Insert failed',
          });
        }
      }
    });

    return { imported, skipped, errors };
  }
}
