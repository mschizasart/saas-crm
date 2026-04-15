import { Injectable } from '@nestjs/common';
import { create } from 'xmlbuilder2';

@Injectable()
export class EinvoiceService {
  /**
   * Generate a UBL 2.1 Invoice XML document for an invoice.
   * Follows the EN 16931 / PEPPOL BIS Billing 3.0 structure at a simplified level.
   */
  generateUblXml(invoice: any, organization: any): string {
    const currency = invoice.currency || 'EUR';
    const issueDate = this.formatDate(invoice.issueDate || invoice.createdAt);
    const dueDate = this.formatDate(invoice.dueDate);

    const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele('Invoice', {
      xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      'xmlns:cac':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      'xmlns:cbc':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    });

    doc.ele('cbc:CustomizationID').txt(
      'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    );
    doc.ele('cbc:ProfileID').txt(
      'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    );
    doc.ele('cbc:ID').txt(String(invoice.number || invoice.id));
    doc.ele('cbc:IssueDate').txt(issueDate);
    if (dueDate) doc.ele('cbc:DueDate').txt(dueDate);
    doc.ele('cbc:InvoiceTypeCode').txt('380');
    if (invoice.notes) doc.ele('cbc:Note').txt(String(invoice.notes));
    doc.ele('cbc:DocumentCurrencyCode').txt(currency);

    // Supplier (our organization)
    const supplier = doc.ele('cac:AccountingSupplierParty').ele('cac:Party');
    const supplierName = supplier.ele('cac:PartyName');
    supplierName.ele('cbc:Name').txt(organization?.name || 'Supplier');

    if (organization?.address) {
      const addr = supplier.ele('cac:PostalAddress');
      if (organization.address)
        addr.ele('cbc:StreetName').txt(String(organization.address));
      if (organization.city) addr.ele('cbc:CityName').txt(String(organization.city));
      if (organization.postalCode)
        addr.ele('cbc:PostalZone').txt(String(organization.postalCode));
      if (organization.country)
        addr
          .ele('cac:Country')
          .ele('cbc:IdentificationCode')
          .txt(String(organization.country));
    }

    if (organization?.vatNumber) {
      const tax = supplier.ele('cac:PartyTaxScheme');
      tax.ele('cbc:CompanyID').txt(String(organization.vatNumber));
      tax.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
    }

    const supplierLegal = supplier.ele('cac:PartyLegalEntity');
    supplierLegal
      .ele('cbc:RegistrationName')
      .txt(organization?.name || 'Supplier');
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

    // Tax total
    const taxAmount = Number(invoice.taxTotal || invoice.tax || 0);
    const taxTotal = doc.ele('cac:TaxTotal');
    taxTotal
      .ele('cbc:TaxAmount', { currencyID: currency })
      .txt(taxAmount.toFixed(2));

    // Legal monetary totals
    const subtotal = Number(invoice.subtotal || 0);
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
      const qty = Number(item.quantity || 1);
      line
        .ele('cbc:InvoicedQuantity', { unitCode: item.unit || 'EA' })
        .txt(qty.toString());
      const lineAmt = Number(
        item.total ?? item.lineTotal ?? qty * Number(item.unitPrice || 0),
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
        .txt(Number(item.unitPrice || 0).toFixed(2));
    });

    return doc.end({ prettyPrint: true });
  }

  private formatDate(d: any): string {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.toISOString().substring(0, 10);
  }
}
