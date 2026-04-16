import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Simple CSV parser that handles:
 * - Quoted fields with commas inside
 * - Double-quoted escaped quotes
 * - Newlines in quoted fields
 */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let fields: string[] = [];

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < csv.length && csv[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else if (ch === '\n' || (ch === '\r' && csv[i + 1] === '\n')) {
        fields.push(current.trim());
        current = '';
        if (fields.some((f) => f.length > 0)) {
          rows.push(fields);
        }
        fields = [];
        if (ch === '\r') i++; // skip \n after \r
      } else {
        current += ch;
      }
    }
  }

  // Last field / row
  fields.push(current.trim());
  if (fields.some((f) => f.length > 0)) {
    rows.push(fields);
  }

  return rows;
}

@Injectable()
export class ImportsService {
  constructor(private prisma: PrismaService) {}

  async importClients(orgId: string, csvData: string): Promise<ImportResult> {
    const rows = parseCsv(csvData);
    if (rows.length === 0) {
      return { imported: 0, skipped: 0, errors: ['CSV is empty'] };
    }

    // First row is header
    const headerRow = rows[0].map((h) => h.toLowerCase().trim());
    const dataRows = rows.slice(1);

    const colIndex = (names: string[]): number => {
      for (const name of names) {
        const idx = headerRow.indexOf(name);
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const companyCol = colIndex(['company', 'company_name', 'name']);
    const phoneCol = colIndex(['phone', 'telephone']);
    const websiteCol = colIndex(['website', 'url']);
    const addressCol = colIndex(['address', 'street']);
    const cityCol = colIndex(['city']);
    const countryCol = colIndex(['country']);
    const vatCol = colIndex(['vat', 'vat_number', 'tax_id']);
    const emailCol = colIndex(['email', 'contact_email']);

    if (companyCol === -1) {
      return { imported: 0, skipped: 0, errors: ['Missing required "company" column in CSV header'] };
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2; // 1-based, +1 for header
      const company = row[companyCol]?.trim();

      if (!company) {
        skipped++;
        errors.push(`Row ${rowNum}: Missing company name, skipped`);
        continue;
      }

      try {
        await this.prisma.withOrganization(orgId, async (tx) => {
          const client = await tx.client.create({
            data: {
              organizationId: orgId,
              company,
              phone: phoneCol >= 0 ? row[phoneCol]?.trim() || null : null,
              website: websiteCol >= 0 ? row[websiteCol]?.trim() || null : null,
              address: addressCol >= 0 ? row[addressCol]?.trim() || null : null,
              city: cityCol >= 0 ? row[cityCol]?.trim() || null : null,
              country: countryCol >= 0 ? row[countryCol]?.trim() || null : null,
              vat: vatCol >= 0 ? row[vatCol]?.trim() || null : null,
            },
          });

          // Optionally create a contact if email is present
          const email = emailCol >= 0 ? row[emailCol]?.trim() : null;
          if (email) {
            const bcrypt = await import('bcryptjs');
            const hash = await bcrypt.hash(Math.random().toString(36).slice(-12), 12);
            await tx.user.create({
              data: {
                organizationId: orgId,
                email,
                password: hash,
                passwordFormat: 'bcrypt',
                firstName: company,
                lastName: '',
                type: 'contact',
                clientId: client.id,
                isPrimary: true,
                active: true,
              },
            });
          }
        });
        imported++;
      } catch (err) {
        skipped++;
        errors.push(`Row ${rowNum}: ${(err as Error).message}`);
      }
    }

    return { imported, skipped, errors };
  }

  async importLeads(orgId: string, csvData: string): Promise<ImportResult> {
    const rows = parseCsv(csvData);
    if (rows.length === 0) {
      return { imported: 0, skipped: 0, errors: ['CSV is empty'] };
    }

    const headerRow = rows[0].map((h) => h.toLowerCase().trim());
    const dataRows = rows.slice(1);

    const colIndex = (names: string[]): number => {
      for (const name of names) {
        const idx = headerRow.indexOf(name);
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const nameCol = colIndex(['name', 'lead_name', 'full_name']);
    const emailCol = colIndex(['email']);
    const phoneCol = colIndex(['phone', 'telephone']);
    const companyCol = colIndex(['company', 'company_name']);
    const positionCol = colIndex(['position', 'title', 'job_title']);
    const sourceCol = colIndex(['source']);
    const statusCol = colIndex(['status']);

    if (nameCol === -1) {
      return { imported: 0, skipped: 0, errors: ['Missing required "name" column in CSV header'] };
    }

    // Pre-fetch lead sources and statuses for matching
    const [leadSources, leadStatuses] = await Promise.all([
      this.prisma.leadSource.findMany({ where: { organizationId: orgId } }),
      this.prisma.leadStatus.findMany({ where: { organizationId: orgId } }),
    ]);

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;
      const name = row[nameCol]?.trim();

      if (!name) {
        skipped++;
        errors.push(`Row ${rowNum}: Missing name, skipped`);
        continue;
      }

      // Try to match source/status by name (case-insensitive)
      const sourceValue = sourceCol >= 0 ? row[sourceCol]?.trim() : null;
      const statusValue = statusCol >= 0 ? row[statusCol]?.trim() : null;

      const matchedSource = sourceValue
        ? leadSources.find((s) => s.name.toLowerCase() === sourceValue.toLowerCase())
        : null;
      const matchedStatus = statusValue
        ? leadStatuses.find((s) => s.name.toLowerCase() === statusValue.toLowerCase())
        : leadStatuses.find((s) => s.isDefault) ?? null;

      try {
        await this.prisma.withOrganization(orgId, async (tx) => {
          await tx.lead.create({
            data: {
              organizationId: orgId,
              name,
              email: emailCol >= 0 ? row[emailCol]?.trim() || null : null,
              phone: phoneCol >= 0 ? row[phoneCol]?.trim() || null : null,
              company: companyCol >= 0 ? row[companyCol]?.trim() || null : null,
              description: positionCol >= 0 ? row[positionCol]?.trim() || null : null,
              sourceId: matchedSource?.id ?? null,
              statusId: matchedStatus?.id ?? null,
            },
          });
        });
        imported++;
      } catch (err) {
        skipped++;
        errors.push(`Row ${rowNum}: ${(err as Error).message}`);
      }
    }

    return { imported, skipped, errors };
  }
}
