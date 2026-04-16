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

const fmtMoney = (v: any): string => {
  const n = Number(v ?? 0);
  return n.toFixed(2);
};

export function renderStatementHtml(
  client: any,
  invoices: any[],
  payments: any[],
  organization: any,
): string {
  // Merge invoices and payments into a chronological list
  type Entry = {
    date: Date;
    type: 'invoice' | 'payment';
    description: string;
    debit: number;
    credit: number;
  };

  const entries: Entry[] = [];

  for (const inv of invoices) {
    entries.push({
      date: new Date(inv.date),
      type: 'invoice',
      description: `Invoice ${inv.number} (${esc(inv.status)})`,
      debit: Number(inv.total ?? 0),
      credit: 0,
    });
  }

  for (const pay of payments) {
    entries.push({
      date: new Date(pay.paymentDate),
      type: 'payment',
      description: `Payment${pay.transactionId ? ' #' + pay.transactionId : ''}`,
      debit: 0,
      credit: Number(pay.amount ?? 0),
    });
  }

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());

  let runningBalance = 0;
  const rowsHtml = entries
    .map((e) => {
      runningBalance += e.debit - e.credit;
      return `
      <tr>
        <td>${fmtDate(e.date)}</td>
        <td>${e.description}</td>
        <td class="num">${e.debit ? fmtMoney(e.debit) : ''}</td>
        <td class="num">${e.credit ? fmtMoney(e.credit) : ''}</td>
        <td class="num">${fmtMoney(runningBalance)}</td>
      </tr>`;
    })
    .join('');

  const totalInvoiced = invoices.reduce((s, i) => s + Number(i.total ?? 0), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const balance = totalInvoiced - totalPaid;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Statement — ${esc(client.company)}</title>
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
    border-bottom: 3px solid #3B82F6;
    padding-bottom: 20px;
    margin-bottom: 30px;
  }
  .org { flex: 1; }
  .org-name { font-size: 20px; font-weight: 700; color: #111827; }
  .org-address { color: #6B7280; font-size: 11px; margin-top: 4px; white-space: pre-line; }
  .statement-meta { text-align: right; }
  .statement-title {
    font-size: 28px;
    font-weight: 800;
    color: #3B82F6;
    letter-spacing: 1px;
    margin: 0 0 8px 0;
  }
  .meta-row { margin-top: 6px; font-size: 11px; color: #6B7280; }
  .meta-row strong { color: #111827; }
  .client-box {
    background: #F9FAFB;
    padding: 15px;
    border-radius: 6px;
    margin-bottom: 25px;
  }
  .client-box-label {
    text-transform: uppercase;
    font-size: 10px;
    color: #6B7280;
    letter-spacing: 1px;
    margin-bottom: 6px;
  }
  .client-box-name { font-weight: 700; font-size: 13px; color: #111827; }
  .client-box-details { color: #6B7280; margin-top: 4px; }
  table.entries {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  table.entries thead th {
    background: #3B82F6;
    color: #fff;
    text-align: left;
    padding: 10px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  table.entries thead th.num { text-align: right; }
  table.entries tbody td {
    padding: 10px;
    border-bottom: 1px solid #E5E7EB;
    vertical-align: top;
  }
  table.entries tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.entries tbody tr:nth-child(even) { background: #F9FAFB; }
  .summary {
    width: 40%;
    margin-left: auto;
    margin-bottom: 25px;
  }
  .summary table { width: 100%; border-collapse: collapse; }
  .summary td { padding: 6px 10px; font-size: 12px; }
  .summary td.label { color: #6B7280; }
  .summary td.val { text-align: right; color: #111827; font-weight: 500; }
  .summary tr.grand td {
    border-top: 2px solid #3B82F6;
    padding-top: 10px;
    font-size: 14px;
    font-weight: 700;
    color: #3B82F6;
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
      <div class="org-name">${esc(organization?.name ?? '')}</div>
      <div class="org-address">${esc(organization?.address ?? '')}${organization?.phone ? '\n' + esc(organization.phone) : ''}</div>
    </div>
    <div class="statement-meta">
      <div class="statement-title">STATEMENT</div>
      <div class="meta-row"><strong>Date:</strong> ${fmtDate(new Date())}</div>
    </div>
  </div>

  <div class="client-box">
    <div class="client-box-label">Client</div>
    <div class="client-box-name">${esc(client.company)}</div>
    <div class="client-box-details">${esc([client.address, client.city, client.country].filter(Boolean).join(', '))}</div>
  </div>

  <table class="entries">
    <thead>
      <tr>
        <th>Date</th>
        <th>Description</th>
        <th class="num">Invoiced</th>
        <th class="num">Paid</th>
        <th class="num">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="5" style="text-align:center;color:#9CA3AF;padding:20px;">No transactions</td></tr>'}
    </tbody>
  </table>

  <div class="summary">
    <table>
      <tr><td class="label">Total Invoiced</td><td class="val">${fmtMoney(totalInvoiced)}</td></tr>
      <tr><td class="label">Total Paid</td><td class="val">${fmtMoney(totalPaid)}</td></tr>
      <tr class="grand"><td class="label">Balance Due</td><td class="val">${fmtMoney(balance)}</td></tr>
    </table>
  </div>

  <div class="footer">
    <strong>Thank you for your business</strong>
  </div>
</div>
</body>
</html>`;
}
