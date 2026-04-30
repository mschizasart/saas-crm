import { Injectable, NotFoundException } from '@nestjs/common';
import { create } from 'xmlbuilder2';
import { PrismaService } from '../../database/prisma.service';

export type EInvoiceFormat = 'PEPPOL_UBL_2_1' | 'FACTUR_X' | 'GENERIC_UBL';

export const EINVOICE_FORMATS: EInvoiceFormat[] = [
  'PEPPOL_UBL_2_1',
  'FACTUR_X',
  'GENERIC_UBL',
];

export interface EInvoiceSettingsDto {
  format?: EInvoiceFormat;
  senderId?: string | null;
  senderIdScheme?: string | null;
  senderName?: string | null;
  senderTaxId?: string | null;
  senderAddress?: string | null;
  senderCity?: string | null;
  senderPostcode?: string | null;
  senderCountry?: string | null;
  defaultCurrency?: string | null;
  paymentMeansCode?: string | null;
  customXmlSnippet?: string | null;
  enabled?: boolean;
}

/**
 * Effective settings used by the renderer. Mirrors the EInvoiceSettings row
 * shape but with non-nullable defaults so the renderer can rely on them
 * unconditionally. Built by `resolveSettings()` — falls back to the same
 * hard-coded defaults this service used historically when no row exists.
 */
interface ResolvedEInvoiceSettings {
  format: EInvoiceFormat;
  senderId: string | null;
  senderIdScheme: string | null;
  senderName: string | null;
  senderTaxId: string | null;
  senderAddress: string | null;
  senderCity: string | null;
  senderPostcode: string | null;
  senderCountry: string | null;
  defaultCurrency: string;
  paymentMeansCode: string;
  customXmlSnippet: string | null;
  enabled: boolean;
}

const DEFAULT_SETTINGS: ResolvedEInvoiceSettings = {
  format: 'PEPPOL_UBL_2_1',
  senderId: null,
  senderIdScheme: null,
  senderName: null,
  senderTaxId: null,
  senderAddress: null,
  senderCity: null,
  senderPostcode: null,
  senderCountry: null,
  defaultCurrency: 'EUR',
  paymentMeansCode: '30',
  customXmlSnippet: null,
  enabled: false,
};

@Injectable()
export class EinvoiceService {
  constructor(private prisma: PrismaService) {}

  // ─── Settings persistence ────────────────────────────────────────────────

  /**
   * Returns the row as-is (or null if none yet). The controller layer
   * exposes a "first-read creates default" flow via `getOrCreateForOrg`.
   */
  async getForOrg(orgId: string) {
    return this.prisma.withOrganization(orgId, (tx) =>
      tx.eInvoiceSettings.findUnique({ where: { organizationId: orgId } }),
    );
  }

  async getOrCreateForOrg(orgId: string) {
    const existing = await this.getForOrg(orgId);
    if (existing) return existing;
    return this.prisma.withOrganization(orgId, (tx) =>
      tx.eInvoiceSettings.create({
        data: { organizationId: orgId },
      }),
    );
  }

  async upsertForOrg(orgId: string, dto: EInvoiceSettingsDto) {
    const data = {
      format: (dto.format ?? 'PEPPOL_UBL_2_1') as string,
      senderId: dto.senderId ?? null,
      senderIdScheme: dto.senderIdScheme ?? null,
      senderName: dto.senderName ?? null,
      senderTaxId: dto.senderTaxId ?? null,
      senderAddress: dto.senderAddress ?? null,
      senderCity: dto.senderCity ?? null,
      senderPostcode: dto.senderPostcode ?? null,
      senderCountry: dto.senderCountry ?? null,
      defaultCurrency: dto.defaultCurrency ?? 'EUR',
      paymentMeansCode: dto.paymentMeansCode ?? '30',
      customXmlSnippet: dto.customXmlSnippet ?? null,
      enabled: dto.enabled ?? false,
    };
    return this.prisma.withOrganization(orgId, (tx) =>
      tx.eInvoiceSettings.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, ...data },
        update: data,
      }),
    );
  }

  /**
   * Resolve effective settings for the given org. If no row exists, the
   * historical hard-coded defaults are returned so non-EU tenants keep
   * working unchanged.
   */
  async resolveSettings(orgId?: string | null): Promise<ResolvedEInvoiceSettings> {
    if (!orgId) return { ...DEFAULT_SETTINGS };
    const row = await this.getForOrg(orgId);
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
      format: ((row.format as EInvoiceFormat) ?? 'PEPPOL_UBL_2_1'),
      senderId: row.senderId ?? null,
      senderIdScheme: row.senderIdScheme ?? null,
      senderName: row.senderName ?? null,
      senderTaxId: row.senderTaxId ?? null,
      senderAddress: row.senderAddress ?? null,
      senderCity: row.senderCity ?? null,
      senderPostcode: row.senderPostcode ?? null,
      senderCountry: row.senderCountry ?? null,
      defaultCurrency: row.defaultCurrency ?? 'EUR',
      paymentMeansCode: row.paymentMeansCode ?? '30',
      customXmlSnippet: row.customXmlSnippet ?? null,
      enabled: row.enabled,
    };
  }

  // ─── Rendering ───────────────────────────────────────────────────────────

  /**
   * Generate a UBL 2.1 Invoice XML document for an invoice.
   * Follows the EN 16931 / PEPPOL BIS Billing 3.0 structure at a simplified level.
   *
   * Backward-compatible: callers may pass `undefined` settings and we
   * fall back to the historical hard-coded defaults.
   *
   * NOTE on what is and isn't tenant-overridable today:
   *   - CustomizationID / ProfileID (EN 16931 / PEPPOL ids) are still
   *     hard-coded — they are tied to the FORMAT, not free-form per-tenant.
   *     The format selector below picks among canned profile ids.
   *   - Invoice line-level tax categories (cac:ClassifiedTaxCategory) are
   *     NOT emitted — required for full EN 16931 compliance and flagged
   *     as a follow-up.
   *   - cac:PaymentMeans (UN/CEFACT 4461 code) is now emitted from settings.
   *   - The optional customXmlSnippet is appended as a raw extension point
   *     just before the closing root tag — its well-formedness is the
   *     tenant's responsibility.
   */
  generateUblXml(
    invoice: any,
    organization: any,
    settings?: ResolvedEInvoiceSettings,
  ): string {
    const s = settings ?? DEFAULT_SETTINGS;
    const currency = invoice.currency || s.defaultCurrency || 'EUR';
    const issueDate = this.formatDate(invoice.issueDate || invoice.createdAt || invoice.date);
    const dueDate = this.formatDate(invoice.dueDate);

    const { customizationId, profileId } = this.profileIdsForFormat(s.format);

    const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele('Invoice', {
      xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      'xmlns:cac':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      'xmlns:cbc':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
      'xmlns:ext':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
    });

    doc.ele('cbc:CustomizationID').txt(customizationId);
    doc.ele('cbc:ProfileID').txt(profileId);
    doc.ele('cbc:ID').txt(String(invoice.number || invoice.id));
    doc.ele('cbc:IssueDate').txt(issueDate);
    if (dueDate) doc.ele('cbc:DueDate').txt(dueDate);
    doc.ele('cbc:InvoiceTypeCode').txt('380');
    if (invoice.notes || invoice.clientNote) {
      doc.ele('cbc:Note').txt(String(invoice.notes ?? invoice.clientNote));
    }
    doc.ele('cbc:DocumentCurrencyCode').txt(currency);

    // Supplier (our organization) — settings override organization fields when set.
    const supplier = doc.ele('cac:AccountingSupplierParty').ele('cac:Party');

    // PEPPOL participant id (EndpointID) when present — required by PEPPOL BIS 3.0
    // for the actual transmission, but we emit it on the document itself too.
    if (s.senderId && s.senderIdScheme) {
      // senderId may be supplied either as the bare value ("1234567890123")
      // or pre-prefixed ("0088:1234567890123") — strip the prefix if present.
      const bare = s.senderId.includes(':')
        ? s.senderId.split(':').slice(1).join(':')
        : s.senderId;
      supplier
        .ele('cbc:EndpointID', { schemeID: s.senderIdScheme })
        .txt(bare);
    }

    const supplierName = supplier.ele('cac:PartyName');
    supplierName
      .ele('cbc:Name')
      .txt(s.senderName || organization?.name || 'Supplier');

    const addrStreet = s.senderAddress ?? organization?.address ?? null;
    const addrCity = s.senderCity ?? organization?.city ?? null;
    const addrPostal = s.senderPostcode ?? organization?.postalCode ?? organization?.zipCode ?? null;
    const addrCountry = s.senderCountry ?? organization?.country ?? null;
    if (addrStreet || addrCity || addrPostal || addrCountry) {
      const addr = supplier.ele('cac:PostalAddress');
      if (addrStreet) addr.ele('cbc:StreetName').txt(String(addrStreet));
      if (addrCity) addr.ele('cbc:CityName').txt(String(addrCity));
      if (addrPostal) addr.ele('cbc:PostalZone').txt(String(addrPostal));
      if (addrCountry) {
        addr
          .ele('cac:Country')
          .ele('cbc:IdentificationCode')
          .txt(String(addrCountry));
      }
    }

    const taxId = s.senderTaxId ?? organization?.vatNumber ?? null;
    if (taxId) {
      const tax = supplier.ele('cac:PartyTaxScheme');
      tax.ele('cbc:CompanyID').txt(String(taxId));
      tax.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
    }

    const supplierLegal = supplier.ele('cac:PartyLegalEntity');
    supplierLegal
      .ele('cbc:RegistrationName')
      .txt(s.senderName || organization?.name || 'Supplier');
    if (organization?.registrationNumber) {
      supplierLegal
        .ele('cbc:CompanyID')
        .txt(String(organization.registrationNumber));
    }

    // Customer (client)
    const client = invoice.client || {};
    const customer = doc.ele('cac:AccountingCustomerParty').ele('cac:Party');
    customer
      .ele('cac:PartyName')
      .ele('cbc:Name')
      .txt(client.company || client.name || 'Customer');
    if (client.address) {
      const cAddr = customer.ele('cac:PostalAddress');
      cAddr.ele('cbc:StreetName').txt(String(client.address));
      if (client.city) cAddr.ele('cbc:CityName').txt(String(client.city));
      if (client.postalCode)
        cAddr.ele('cbc:PostalZone').txt(String(client.postalCode));
      if (client.country)
        cAddr
          .ele('cac:Country')
          .ele('cbc:IdentificationCode')
          .txt(String(client.country));
    }
    if (client.vatNumber) {
      const cTax = customer.ele('cac:PartyTaxScheme');
      cTax.ele('cbc:CompanyID').txt(String(client.vatNumber));
      cTax.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
    }
    customer
      .ele('cac:PartyLegalEntity')
      .ele('cbc:RegistrationName')
      .txt(client.company || client.name || 'Customer');

    // Payment means — driven by tenant setting (UN/CEFACT 4461).
    if (s.paymentMeansCode) {
      const pm = doc.ele('cac:PaymentMeans');
      pm.ele('cbc:PaymentMeansCode').txt(s.paymentMeansCode);
      if (dueDate) pm.ele('cbc:PaymentDueDate').txt(dueDate);
    }

    // Tax total
    const taxAmount = Number(invoice.taxTotal || invoice.tax || invoice.totalTax || 0);
    const taxTotal = doc.ele('cac:TaxTotal');
    taxTotal
      .ele('cbc:TaxAmount', { currencyID: currency })
      .txt(taxAmount.toFixed(2));

    // Legal monetary totals
    const subtotal = Number(invoice.subtotal || invoice.subTotal || 0);
    const total = Number(invoice.total || 0);
    const paid = Number(invoice.amountPaid || 0);
    const lmt = doc.ele('cac:LegalMonetaryTotal');
    lmt
      .ele('cbc:LineExtensionAmount', { currencyID: currency })
      .txt(subtotal.toFixed(2));
    lmt
      .ele('cbc:TaxExclusiveAmount', { currencyID: currency })
      .txt(subtotal.toFixed(2));
    lmt
      .ele('cbc:TaxInclusiveAmount', { currencyID: currency })
      .txt(total.toFixed(2));
    lmt
      .ele('cbc:PrepaidAmount', { currencyID: currency })
      .txt(paid.toFixed(2));
    lmt
      .ele('cbc:PayableAmount', { currencyID: currency })
      .txt((total - paid).toFixed(2));

    // Invoice lines
    const items = invoice.items || [];
    items.forEach((item: any, idx: number) => {
      const line = doc.ele('cac:InvoiceLine');
      line.ele('cbc:ID').txt(String(idx + 1));
      const qty = Number(item.quantity || item.qty || 1);
      line
        .ele('cbc:InvoicedQuantity', { unitCode: item.unit || 'EA' })
        .txt(qty.toString());
      const lineAmt = Number(
        item.total ?? item.lineTotal ?? qty * Number(item.unitPrice || item.rate || 0),
      );
      line
        .ele('cbc:LineExtensionAmount', { currencyID: currency })
        .txt(lineAmt.toFixed(2));
      const itemEl = line.ele('cac:Item');
      itemEl.ele('cbc:Name').txt(String(item.name || item.description || 'Item'));
      if (item.description && item.description !== item.name) {
        itemEl.ele('cbc:Description').txt(String(item.description));
      }
      const price = line.ele('cac:Price');
      price
        .ele('cbc:PriceAmount', { currencyID: currency })
        .txt(Number(item.unitPrice || item.rate || 0).toFixed(2));
    });

    // Render the canonical UBL portion first; if a customXmlSnippet is set,
    // splice it in just before the closing </Invoice>. We do this textually
    // because xmlbuilder2 will (correctly) refuse raw fragments that aren't
    // wrapped in a single root.
    let xml = doc.end({ prettyPrint: true });
    if (s.customXmlSnippet && s.customXmlSnippet.trim().length > 0) {
      const closing = '</Invoice>';
      const idx = xml.lastIndexOf(closing);
      if (idx >= 0) {
        const snippet = `  <ext:UBLExtensions>\n    <ext:UBLExtension>\n      <ext:ExtensionContent>\n${s.customXmlSnippet}\n      </ext:ExtensionContent>\n    </ext:UBLExtension>\n  </ext:UBLExtensions>\n`;
        xml = xml.slice(0, idx) + snippet + xml.slice(idx);
      }
    }
    return xml;
  }

  /**
   * Resolve current settings + organization, then render the XML for the
   * given existing invoice id. Used by the controller's preview endpoint.
   */
  async generateForInvoiceId(orgId: string, invoiceId: string): Promise<string> {
    const settings = await this.resolveSettings(orgId);
    const { invoice, organization } = await this.prisma.withOrganization(
      orgId,
      async (tx) => {
        const inv = await tx.invoice.findFirst({
          where: { id: invoiceId, organizationId: orgId },
          include: {
            client: true,
            items: { orderBy: { order: 'asc' } },
          },
        });
        if (!inv) throw new NotFoundException('Invoice not found');
        const org = await tx.organization.findUnique({
          where: { id: orgId },
        });
        return { invoice: inv, organization: org };
      },
    );
    return this.generateUblXml(invoice, organization, settings);
  }

  /**
   * Synthetic invoice — useful for tenants to inspect the schema before
   * issuing a real invoice. No DB access; uses the org's settings if any.
   */
  async generateSample(orgId?: string | null): Promise<string> {
    const settings = await this.resolveSettings(orgId);
    const today = new Date();
    const due = new Date(today.getTime() + 30 * 86_400_000);
    const sampleInvoice = {
      number: 'SAMPLE-0001',
      issueDate: today,
      dueDate: due,
      currency: settings.defaultCurrency,
      clientNote: 'Sample invoice — generated for schema preview only.',
      subTotal: 100,
      totalTax: 21,
      total: 121,
      amountPaid: 0,
      client: {
        name: 'Sample Customer Ltd.',
        company: 'Sample Customer Ltd.',
        address: 'Customer Street 1',
        city: 'Brussels',
        postalCode: '1000',
        country: 'BE',
        vatNumber: 'BE0123456789',
      },
      items: [
        {
          description: 'Consulting services',
          name: 'Consulting services',
          qty: 1,
          rate: 100,
          unit: 'HUR',
        },
      ],
    };
    const sampleOrg = {
      name: settings.senderName ?? 'Your Company Ltd.',
      address: settings.senderAddress ?? null,
      city: settings.senderCity ?? null,
      postalCode: settings.senderPostcode ?? null,
      country: settings.senderCountry ?? null,
      vatNumber: settings.senderTaxId ?? null,
    };
    return this.generateUblXml(sampleInvoice, sampleOrg, settings);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private profileIdsForFormat(format: EInvoiceFormat): {
    customizationId: string;
    profileId: string;
  } {
    switch (format) {
      case 'PEPPOL_UBL_2_1':
        return {
          customizationId:
            'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
          profileId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
        };
      case 'FACTUR_X':
        // Factur-X is a hybrid PDF/A-3 + UBL embedded; for the XML payload
        // alone, EN 16931 is the canonical CustomizationID. We don't yet
        // emit the PDF wrapper — out of scope.
        return {
          customizationId: 'urn:cen.eu:en16931:2017',
          profileId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
        };
      case 'GENERIC_UBL':
      default:
        return {
          customizationId: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
          profileId: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
        };
    }
  }

  private formatDate(d: any): string {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.toISOString().substring(0, 10);
  }
}
