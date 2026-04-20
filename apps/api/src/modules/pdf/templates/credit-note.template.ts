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

// Normalise one item — the service layer uses quantity/unitPrice/taxRate/total,
// while the raw prisma model uses qty/rate. Accept both.
const normaliseItem = (it: any) => ({
  description: it?.description ?? '',
  qty: Number(it?.quantity ?? it?.qty ?? 0),
  unitPrice: Number(it?.unitPrice ?? it?.rate ?? 0),
  taxRate: Number(it?.taxRate ?? 0),
  total: it?.total != null ? Number(it.total) : null,
});

export function renderCreditNoteHtml(
  creditNote: any,
  organization: any,
): string {
  const currency = creditNote?.currency ?? 'USD';
  const items = (creditNote?.items ?? []).map(normaliseItem);

  const itemRows = items
    .map(
      (it: any) => `
      <tr>
        <td>${esc(it.description)}</td>
        <td class="num">${it.qty.toFixed(2)}</td>
        <td class="num">${fmtMoney(it.unitPrice, currency)}</td>
        <td class="num">${it.taxRate.toFixed(2)}%</td>
        <td class="num">${fmtMoney(
          it.total ?? it.qty * it.unitPrice,
          currency,
        )}</td>
      </tr>`,
    )
    .join('');

  const subtotal = creditNote?.subtotal ?? creditNote?.subTotal ?? 0;
  const tax = creditNote?.tax ?? creditNote?.totalTax ?? 0;
  const discount = creditNote?.discount ?? 0;
  const total = creditNote?.total ?? 0;
  const notes = creditNote?.notes ?? creditNote?.clientNote ?? '';
  const client = creditNote?.client ?? {};
  const invoice = creditNote?.invoice ?? null;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Credit Note ${esc(creditNote?.number ?? '')}</title>
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
  .wrap { padding: 0; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #DC2626;
    padding-bottom: 20px;
    margin-bottom: 30px;
  }
  .org { flex: 1; }
  .org-logo {
    width: 80px; height: 80px;
    background: #FEF2F2;
    border: 1px dashed #DC2626;
    display: flex; align-items: center; justify-content: center;
    color: #DC2626; font-weight: 600;
    margin-bottom: 10px;
  }
  .org-name { font-size: 20px; font-weight: 700; color: #111827; }
  .org-address { color: #6B7280; font-size: 11px; margin-top: 4px; white-space: pre-line; }
  .doc-meta { text-align: right; }
  .doc-title {
    font-size: 28px;
    font-weight: 800;
    color: #DC2626;
    letter-spacing: 1px;
    margin: 0 0 8px 0;
  }
  .doc-number { font-size: 14px; color: #374151; font-weight: 600; }
  .meta-row { margin-top: 10px; font-size: 11px; color: #6B7280; }
  .meta-row strong { color: #111827; display: inline-block; min-width: 80px; }
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
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  table.items thead th {
    background: #DC2626;
    color: #fff;
    text-align: left;
    padding: 10px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  table.items thead th.num { text-align: right; }
  table.items tbody td {
    padding: 10px;
    border-bottom: 1px solid #E5E7EB;
    vertical-align: top;
  }
  table.items tbody td.num { text-align: right; }
  table.items tbody tr:nth-child(even) { background: #F9FAFB; }
  .totals {
    width: 40%;
    margin-left: auto;
    margin-bottom: 25px;
  }
  .totals table { width: 100%; border-collapse: collapse; }
  .totals td { padding: 6px 10px; font-size: 12px; }
  .totals td.label { color: #6B7280; }
  .totals td.val { text-align: right; color: #111827; font-weight: 500; }
  .totals tr.grand td {
    border-top: 2px solid #DC2626;
    padding-top: 10px;
    font-size: 14px;
    font-weight: 700;
    color: #DC2626;
  }
  .notes {
    background: #FEFCE8;
    border-left: 3px solid #FACC15;
    padding: 12px 15px;
    margin-bottom: 15px;
    font-size: 11px;
    color: #713F12;
  }
  .footer {
    text-align: center;
    padding-top: 20px;
    border-top: 1px solid #E5E7EB;
    color: #6B7280;
    font-size: 11px;
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="org">
      <div class="org-logo">LOGO</div>
      <div class="org-name">${esc(organization?.name ?? '')}</div>
      <div class="org-address">${esc(organization?.address ?? '')}${organization?.email ? '\n' + esc(organization.email) : ''}${organization?.phone ? '\n' + esc(organization.phone) : ''}</div>
    </div>
    <div class="doc-meta">
      <div class="doc-title">CREDIT NOTE</div>
      <div class="doc-number">#${esc(creditNote?.number ?? '')}</div>
      <div class="meta-row"><strong>Date:</strong> ${fmtDate(creditNote?.date)}</div>
      <div class="meta-row"><strong>Status:</strong> ${esc(
        (creditNote?.status ?? '').toUpperCase(),
      )}</div>
      ${invoice?.number ? `<div class="meta-row"><strong>Invoice:</strong> ${esc(invoice.number)}</div>` : ''}
    </div>
  </div>

  <div class="bill-to">
    <div class="bill-to-label">Credit To</div>
    <div class="bill-to-name">${esc(client?.company ?? '')}</div>
    <div class="bill-to-details">${esc(client?.address ?? '')}${client?.email ? '\n' + esc(client.email) : ''}</div>
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
      <tr><td class="label">Subtotal</td><td class="val">${fmtMoney(subtotal, currency)}</td></tr>
      <tr><td class="label">Tax</td><td class="val">${fmtMoney(tax, currency)}</td></tr>
      <tr><td class="label">Discount</td><td class="val">- ${fmtMoney(discount, currency)}</td></tr>
      <tr class="grand"><td class="label">Total</td><td class="val">${fmtMoney(total, currency)}</td></tr>
    </table>
  </div>

  ${notes ? `<div class="notes"><strong>Notes:</strong> ${esc(notes)}</div>` : ''}

  <div class="footer">
    <strong>Credit issued on behalf of ${esc(organization?.name ?? '')}</strong>
  </div>
</div>
</body>
</html>`;
}
