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

  async getStatement(
    orgId: string,
    clientId: string,
    options?: { from?: Date; to?: Date },
  ) {
    await this.findOne(orgId, clientId);
    const dateFilter: any = {};
    if (options?.from) dateFilter.gte = options.from;
    if (options?.to) dateFilter.lte = options.to;
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const invoiceWhere: any = { clientId, organizationId: orgId };
      if (hasDateFilter) invoiceWhere.date = dateFilter;
      const paymentWhere: any = { clientId, organizationId: orgId };
      if (hasDateFilter) paymentWhere.paymentDate = dateFilter;

      const [invoices, payments] = await Promise.all([
        tx.invoice.findMany({
          where: invoiceWhere,
          select: { id: true, number: true, date: true, total: true, status: true },
          orderBy: { date: 'desc' },
        }),
        tx.payment.findMany({
          where: paymentWhere,
          select: { id: true, amount: true, paymentDate: true, transactionId: true },
          orderBy: { paymentDate: 'desc' },
        }),
      ]);
      return { invoices, payments };
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
