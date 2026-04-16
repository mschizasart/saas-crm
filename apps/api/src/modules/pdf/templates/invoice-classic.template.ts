const esc = (v: any): string => {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const fmtDate = (d: any): string => {
  if (!d) return '\u2014';
  try {
    return new Date(d).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '\u2014';
  }
};

const fmtMoney = (v: any, currency = 'USD'): string => {
  const n = Number(v ?? 0);
  return `${currency} ${n.toFixed(2)}`;
};

export function renderInvoiceHtml(invoice: any, organization: any): string {
  const currency = invoice.currency ?? 'USD';
  const items = (invoice.items ?? []) as any[];

  const itemRows = items
    .map(
      (it) => `
      <tr>
        <td style="padding:8px 10px;border:1px solid #D1D5DB;">${esc(it.description)}</td>
        <td style="padding:8px 10px;border:1px solid #D1D5DB;text-align:right;">${Number(it.quantity).toFixed(2)}</td>
        <td style="padding:8px 10px;border:1px solid #D1D5DB;text-align:right;">${fmtMoney(it.unitPrice, currency)}</td>
        <td style="padding:8px 10px;border:1px solid #D1D5DB;text-align:right;">${Number(it.taxRate ?? 0).toFixed(2)}%</td>
        <td style="padding:8px 10px;border:1px solid #D1D5DB;text-align:right;font-weight:600;">${fmtMoney(Number(it.quantity) * Number(it.unitPrice), currency)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Invoice ${esc(invoice.number)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    color: #1F2937;
    font-size: 12px;
    line-height: 1.6;
    padding: 40px;
  }
</style>
</head>
<body>
  <!-- Header: company left, invoice details right -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;">
    <div style="flex:1;">
      <!-- Logo area -->
      <div style="width:100px;height:60px;border:2px solid #9CA3AF;display:flex;align-items:center;justify-content:center;margin-bottom:12px;color:#6B7280;font-size:11px;font-family:Arial,sans-serif;">
        COMPANY LOGO
      </div>
      <div style="font-size:18px;font-weight:700;color:#111827;font-family:Georgia,serif;">${esc(organization?.name ?? '')}</div>
      <div style="font-size:11px;color:#6B7280;margin-top:4px;white-space:pre-line;">${esc(organization?.address ?? '')}${organization?.email ? '\n' + esc(organization.email) : ''}${organization?.phone ? '\n' + esc(organization.phone) : ''}${organization?.vatNumber ? '\nVAT: ' + esc(organization.vatNumber) : ''}</div>
    </div>
    <div style="border:2px solid #374151;padding:16px;min-width:240px;">
      <div style="font-size:22px;font-weight:700;text-align:center;color:#111827;border-bottom:1px solid #D1D5DB;padding-bottom:8px;margin-bottom:8px;text-transform:uppercase;letter-spacing:2px;">Invoice</div>
      <table style="width:100%;font-size:11px;">
        <tr>
          <td style="padding:3px 0;color:#6B7280;font-weight:600;">Invoice No:</td>
          <td style="padding:3px 0;text-align:right;font-weight:700;">${esc(invoice.number)}</td>
        </tr>
        <tr>
          <td style="padding:3px 0;color:#6B7280;font-weight:600;">Date:</td>
          <td style="padding:3px 0;text-align:right;">${fmtDate(invoice.date)}</td>
        </tr>
        <tr>
          <td style="padding:3px 0;color:#6B7280;font-weight:600;">Due Date:</td>
          <td style="padding:3px 0;text-align:right;">${fmtDate(invoice.dueDate)}</td>
        </tr>
        <tr>
          <td style="padding:3px 0;color:#6B7280;font-weight:600;">Status:</td>
          <td style="padding:3px 0;text-align:right;font-weight:600;">${esc((invoice.status ?? '').toUpperCase())}</td>
        </tr>
      </table>
    </div>
  </div>

  <!-- Bill To -->
  <div style="margin-bottom:24px;padding:14px;border:1px solid #D1D5DB;background:#F9FAFB;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;margin-bottom:6px;font-family:Arial,sans-serif;font-weight:700;">Bill To</div>
    <div style="font-size:14px;font-weight:700;color:#111827;">${esc(invoice.client?.company ?? '')}</div>
    <div style="font-size:11px;color:#6B7280;margin-top:4px;white-space:pre-line;">${esc(invoice.client?.address ?? '')}${invoice.client?.email ? '\n' + esc(invoice.client.email) : ''}</div>
  </div>

  <!-- Items table with full borders -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
    <thead>
      <tr style="background:#374151;">
        <th style="padding:10px;text-align:left;color:#fff;font-size:11px;border:1px solid #374151;font-family:Arial,sans-serif;">Description</th>
        <th style="padding:10px;text-align:right;color:#fff;font-size:11px;border:1px solid #374151;font-family:Arial,sans-serif;">Qty</th>
        <th style="padding:10px;text-align:right;color:#fff;font-size:11px;border:1px solid #374151;font-family:Arial,sans-serif;">Unit Price</th>
        <th style="padding:10px;text-align:right;color:#fff;font-size:11px;border:1px solid #374151;font-family:Arial,sans-serif;">Tax %</th>
        <th style="padding:10px;text-align:right;color:#fff;font-size:11px;border:1px solid #374151;font-family:Arial,sans-serif;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows || '<tr><td colspan="5" style="text-align:center;color:#9CA3AF;padding:20px;border:1px solid #D1D5DB;">No items</td></tr>'}
    </tbody>
  </table>

  <!-- Totals -->
  <div style="margin-left:auto;width:280px;margin-bottom:24px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:6px 10px;font-size:12px;color:#6B7280;border-bottom:1px solid #E5E7EB;">Subtotal</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #E5E7EB;font-weight:500;">${fmtMoney(invoice.subtotal, currency)}</td>
      </tr>
      <tr>
        <td style="padding:6px 10px;font-size:12px;color:#6B7280;border-bottom:1px solid #E5E7EB;">Tax</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #E5E7EB;font-weight:500;">${fmtMoney(invoice.tax, currency)}</td>
      </tr>
      <tr>
        <td style="padding:6px 10px;font-size:12px;color:#6B7280;border-bottom:1px solid #E5E7EB;">Discount</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #E5E7EB;font-weight:500;">- ${fmtMoney(invoice.discount, currency)}</td>
      </tr>
      <tr style="background:#374151;">
        <td style="padding:10px;font-size:14px;font-weight:700;color:#fff;">Total</td>
        <td style="padding:10px;font-size:14px;font-weight:700;text-align:right;color:#fff;">${fmtMoney(invoice.total, currency)}</td>
      </tr>
    </table>
  </div>

  ${invoice.notes ? `<div style="background:#FEFCE8;border-left:3px solid #FACC15;padding:12px 15px;margin-bottom:15px;font-size:11px;color:#713F12;"><strong>Notes:</strong> ${esc(invoice.notes)}</div>` : ''}
  ${invoice.terms ? `<div style="padding:12px 15px;border:1px solid #D1D5DB;font-size:11px;color:#6B7280;margin-bottom:20px;"><strong>Terms &amp; Conditions:</strong> ${esc(invoice.terms)}</div>` : ''}

  <!-- Bank Details area -->
  <div style="border:1px solid #D1D5DB;padding:14px;margin-bottom:24px;background:#F9FAFB;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;margin-bottom:6px;font-family:Arial,sans-serif;font-weight:700;">Payment Details</div>
    <div style="font-size:11px;color:#6B7280;">Please make payment to the bank details provided in your account, or use the online payment link if available.</div>
  </div>

  <!-- Footer -->
  <div style="text-align:center;padding-top:16px;border-top:2px solid #374151;color:#6B7280;font-size:11px;">
    <strong style="color:#374151;">Thank you for your business</strong>
    <div style="margin-top:4px;font-size:10px;">${esc(organization?.name ?? '')} ${organization?.phone ? ' | ' + esc(organization.phone) : ''} ${organization?.email ? ' | ' + esc(organization.email) : ''}</div>
  </div>
</body>
</html>`;
}
