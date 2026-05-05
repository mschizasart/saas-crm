import { buildCsv, csvFilename, EXPORT_ROW_CAP } from './csv-writer';

/**
 * RFC-4180 CSV writer.
 *
 * The writer is small but it is the trusted layer between Prisma rows and an
 * Excel-friendly download. Quoting bugs here corrupt every export. We exercise
 * the field-escape rules directly rather than going through any module
 * scaffold — the function is pure.
 */

describe('csv-writer', () => {
  describe('buildCsv', () => {
    it('prepends a UTF-8 BOM and uses CRLF row separators', () => {
      const csv = buildCsv({
        columns: [{ key: 'a', label: 'A' }],
        rows: [{ a: 'x' }, { a: 'y' }],
      });

      expect(csv.charCodeAt(0)).toBe(0xfeff);
      // Strip BOM, then split by CRLF — header + 2 rows = 3 lines
      const body = csv.slice(1);
      expect(body.split('\r\n')).toEqual(['A', 'x', 'y']);
    });

    it('quotes fields that contain commas, quotes, CR, or LF', () => {
      const csv = buildCsv({
        columns: [
          { key: 'plain', label: 'Plain' },
          { key: 'comma', label: 'Comma' },
          { key: 'quote', label: 'Quote' },
          { key: 'newline', label: 'Newline' },
        ],
        rows: [
          {
            plain: 'no-quote-needed',
            comma: 'a,b',
            quote: 'she said "hi"',
            newline: 'line1\nline2',
          },
        ],
      });

      const lines = csv.slice(1).split('\r\n');
      // Header is plain
      expect(lines[0]).toBe('Plain,Comma,Quote,Newline');
      // Each problem field must be wrapped in quotes; embedded quotes doubled
      expect(lines[1]).toBe(
        'no-quote-needed,"a,b","she said ""hi""","line1\nline2"',
      );
    });

    it('renders null/undefined as empty strings', () => {
      const csv = buildCsv({
        columns: [
          { key: 'a', label: 'A' },
          { key: 'b', label: 'B' },
        ],
        rows: [{ a: null, b: undefined }],
      });
      const lines = csv.slice(1).split('\r\n');
      expect(lines[1]).toBe(',');
    });

    it('formats Date values as ISO YYYY-MM-DD (no timezone drift)', () => {
      const csv = buildCsv({
        columns: [{ key: 'createdAt', label: 'Created' }],
        rows: [{ createdAt: new Date('2025-03-15T23:59:59.000Z') }],
      });
      const lines = csv.slice(1).split('\r\n');
      expect(lines[1]).toBe('2025-03-15');
    });

    it('formats booleans as Yes/No', () => {
      const csv = buildCsv({
        columns: [
          { key: 'paid', label: 'Paid' },
          { key: 'overdue', label: 'Overdue' },
        ],
        rows: [{ paid: true, overdue: false }],
      });
      const lines = csv.slice(1).split('\r\n');
      expect(lines[1]).toBe('Yes,No');
    });

    it('writes finite numbers; renders Infinity/NaN as empty', () => {
      const csv = buildCsv({
        columns: [
          { key: 'a', label: 'A' },
          { key: 'b', label: 'B' },
          { key: 'c', label: 'C' },
        ],
        rows: [{ a: 42.5, b: Infinity, c: NaN }],
      });
      const lines = csv.slice(1).split('\r\n');
      expect(lines[1]).toBe('42.5,,');
    });

    it('resolves dotted-path keys (e.g. client.company)', () => {
      const csv = buildCsv({
        columns: [
          { key: 'number', label: 'Number' },
          { key: 'client.company', label: 'Client' },
        ],
        rows: [{ number: 'INV-1', client: { company: 'Acme, Inc.' } }],
      });
      const lines = csv.slice(1).split('\r\n');
      expect(lines[1]).toBe('INV-1,"Acme, Inc."');
    });

    it('returns empty string when a dotted-path traverses null', () => {
      const csv = buildCsv({
        columns: [{ key: 'client.company', label: 'Client' }],
        rows: [{ client: null }, {}],
      });
      const lines = csv.slice(1).split('\r\n');
      expect(lines.slice(1)).toEqual(['', '']);
    });

    it('uses a custom format function when provided', () => {
      const csv = buildCsv({
        columns: [
          {
            key: 'amount',
            label: 'Amount',
            format: (v) => `$${(v as number).toFixed(2)}`,
          },
        ],
        rows: [{ amount: 12.5 }, { amount: 100 }],
      });
      const lines = csv.slice(1).split('\r\n');
      expect(lines.slice(1)).toEqual(['$12.50', '$100.00']);
    });

    it('serializes plain objects via JSON when no toString override', () => {
      const csv = buildCsv({
        columns: [{ key: 'meta', label: 'Meta' }],
        rows: [{ meta: { a: 1, b: 'two' } }],
      });
      const lines = csv.slice(1).split('\r\n');
      // JSON contains quotes, so the result must be wrapped + escaped
      expect(lines[1]).toBe('"{""a"":1,""b"":""two""}"');
    });

    it('uses .toString() for non-plain objects (e.g. Prisma Decimal stub)', () => {
      const decimalLike = {
        toString() {
          return '199.99';
        },
      };
      const csv = buildCsv({
        columns: [{ key: 'total', label: 'Total' }],
        rows: [{ total: decimalLike }],
      });
      const lines = csv.slice(1).split('\r\n');
      expect(lines[1]).toBe('199.99');
    });

    it('produces an empty data section when rows[] is empty (header still present)', () => {
      const csv = buildCsv({
        columns: [{ key: 'a', label: 'Header' }],
        rows: [],
      });
      // BOM + header only — no trailing CRLF
      expect(csv).toBe('﻿Header');
    });
  });

  describe('csvFilename', () => {
    it('produces <entity>-<YYYY-MM-DD>.csv', () => {
      const fixed = new Date('2025-04-30T12:34:56.000Z');
      expect(csvFilename('invoices', fixed)).toBe('invoices-2025-04-30.csv');
    });

    it('uses today by default', () => {
      const name = csvFilename('clients');
      expect(name).toMatch(/^clients-\d{4}-\d{2}-\d{2}\.csv$/);
    });
  });

  describe('EXPORT_ROW_CAP', () => {
    it('is generous enough for SMB tenants', () => {
      // Sanity-check the constant — not a meaningful behaviour test, but
      // catches accidental halving (e.g. typo'd to 1000).
      expect(EXPORT_ROW_CAP).toBeGreaterThanOrEqual(10000);
    });
  });
});
