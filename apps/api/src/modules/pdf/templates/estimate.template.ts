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
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
};

const fmtMoney = (v: any, currency = 'USD'): string => {
  const n = Number(v ?? 0);
  return `${currency} ${n.toFixed(2)}`;
};

export function renderEstimateHtml(estimate: any, organization: any): string {
  const currency = estimate.currency ?? 'USD';
  const items = (estimate.items ?? []) as any[];

  const itemRows = items
    .map(
      (it) => `
      <tr>
        <td>${esc(it.description)}</td>
        <td class="num">${Number(it.quantity).toFixed(2)}</td>
        <td class="num">${fmtMoney(it.unitPrice, currency)}</td>
        <td class="num">${Number(it.taxRate ?? 0).toFixed(2)}%</td>
        <td class="num">${fmtMoney(Number(it.quantity) * Number(it.unitPrice), currency)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Estimate ${esc(estimate.number)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
    color: #1f2937;
    font-size: 12px;
    margin: 0;
    padding: 0;
    line-height: 1.5;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #3B82F6;
    padding-bottom: 20px;
    margin-bottom: 30px;
  }
  .org { flex: 1; }
  .org-logo {
    width: 80px; height: 80px;
    background: #EFF6FF;
    border: 1px dashed #3B82F6;
    display: flex; align-items: center; justify-content: center;
    color: #3B82F6; font-weight: 600;
    margin-bottom: 10px;
  }
  .org-name { font-size: 20px; font-weight: 700; color: #111827; }
  .org-address { color: #6B7280; font-size: 11px; margin-top: 4px; white-space: pre-line; }
  .meta { text-align: right; }
  .title {
    font-size: 28px;
    font-weight: 800;
    color: #3B82F6;
    letter-spacing: 1px;
    margin: 0 0 8px 0;
  }
  .number { font-size: 14px; color: #374151; font-weight: 600; }
  .meta-row { margin-top: 10px; font-size: 11px; color: #6B7280; }
  .meta-row strong { color: #111827; display: inline-block; min-width: 90px; }
  .bill-to {
    background: #F9FAFB;
    padding: 15px;
    border-radius: 6px;
    margin-bottom: 25px;
  }
  .bill-to-label {
    text-transform: uppercase;
    font-size: 10px;
    color: #6B7280;
    letter-spacing: 1px;
    margin-bottom: 6px;
  }
  .bill-to-name { font-weight: 700; font-size: 13px; color: #111827; }
  .bill-to-details { color: #6B7280; margin-top: 4px; white-space: pre-line; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  table.items thead th {
    background: #3B82F6;
    color: #fff;
    text-align: left;
    padding: 10px;
    font-size: 11px;
    text-transform: uppercase;
  }
  table.items thead th.num { text-align: right; }
  table.items tbody td {
    padding: 10px;
    border-bottom: 1px solid #E5E7EB;
  }
  table.items tbody td.num { text-align: right; }
  table.items tbody tr:nth-child(even) { background: #F9FAFB; }
  .totals { width: 40%; margin-left: auto; margin-bottom: 25px; }
  .totals table { width: 100%; border-collapse: collapse; }
  .totals td { padding: 6px 10px; font-size: 12px; }
  .totals td.label { color: #6B7280; }
  .totals td.val { text-align: right; font-weight: 500; }
  .totals tr.grand td {
    border-top: 2px solid #3B82F6;
    padding-top: 10px;
    font-size: 14px;
    font-weight: 700;
    color: #3B82F6;
  }
  .notes {
    background: #FEFCE8;
    border-left: 3px solid #FACC15;
    padding: 12px 15px;
    margin-bottom: 15px;
    font-size: 11px;
    color: #713F12;
  }
  .terms {
    padding: 12px 15px;
    border: 1px solid #E5E7EB;
    border-radius: 4px;
    font-size: 11px;
    color: #6B7280;
    margin-bottom: 25px;
  }
  .footer {
    text-align: center;
    padding-top: 20px;
    border-top: 1px solid #E5E7EB;
    color: #6B7280;
    font-size: 11px;
  }
  .footer strong { color: #3B82F6; }
</style>
</head>
<body>
  <div class="header">
    <div class="org">
      <div class="org-logo">LOGO</div>
      <div class="org-name">${esc(organization?.name ?? '')}</div>
      <div class="org-address">${esc(organization?.address ?? '')}${organization?.email ? '\n' + esc(organization.email) : ''}${organization?.phone ? '\n' + esc(organization.phone) : ''}</div>
    </div>
    <div class="meta">
      <div class="title">ESTIMATE</div>
      <div class="number">#${esc(estimate.number)}</div>
      <div class="meta-row"><strong>Issue Date:</strong> ${fmtDate(estimate.date)}</div>
      <div class="meta-row"><strong>Valid Until:</strong> ${fmtDate(estimate.validUntil ?? estimate.expiryDate)}</div>
      <div class="meta-row"><strong>Status:</strong> ${esc((estimate.status ?? '').toUpperCase())}</div>
    </div>
  </div>

  <div class="bill-to">
    <div class="bill-to-label">Prepared For</div>
    <div class="bill-to-name">${esc(estimate.client?.company ?? '')}</div>
    <div class="bill-to-details">${esc(estimate.client?.address ?? '')}${estimate.client?.email ? '\n' + esc(estimate.client.email) : ''}</div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit Price</th>
        <th class="num">Tax %</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows || '<tr><td colspan="5" style="text-align:center;color:#9CA3AF;padding:20px;">No items</td></tr>'}
    </tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td class="label">Subtotal</td><td class="val">${fmtMoney(estimate.subtotal, currency)}</td></tr>
      <tr><td class="label">Tax</td><td class="val">${fmtMoney(estimate.tax, currency)}</td></tr>
      <tr><td class="label">Discount</td><td class="val">- ${fmtMoney(estimate.discount, currency)}</td></tr>
      <tr class="grand"><td class="label">Total</td><td class="val">${fmtMoney(estimate.total, currency)}</td></tr>
    </table>
  </div>

  ${estimate.notes ? `<div class="notes"><strong>Notes:</strong> ${esc(estimate.notes)}</div>` : ''}
  ${estimate.terms ? `<div class="terms"><strong>Terms &amp; Conditions:</strong> ${esc(estimate.terms)}</div>` : ''}

  <div class="footer">
    <strong>Thank you for considering our proposal</strong>
  </div>
</body>
</html>`;
}
