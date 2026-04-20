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

export function renderReceiptHtml(
  payment: any,
  client: any,
  organization: any,
): string {
  const currency =
    payment?.currency ??
    payment?.invoice?.currency?.code ??
    payment?.invoice?.currency ??
    'USD';
  const invoice = payment?.invoice ?? {};
  const mode =
    payment?.paymentMode?.name ??
    payment?.paymentModeName ??
    payment?.mode ??
    payment?.method ??
    '—';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt — ${esc(payment?.id ?? '')}</title>
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
    border-bottom: 3px solid #10B981;
    padding-bottom: 20px;
    margin-bottom: 30px;
  }
  .org { flex: 1; }
  .org-name { font-size: 20px; font-weight: 700; color: #111827; }
  .org-address { color: #6B7280; font-size: 11px; margin-top: 4px; white-space: pre-line; }
  .receipt-meta { text-align: right; }
  .receipt-title {
    font-size: 28px;
    font-weight: 800;
    color: #10B981;
    letter-spacing: 1px;
    margin: 0 0 8px 0;
  }
  .meta-row { margin-top: 6px; font-size: 11px; color: #6B7280; }
  .meta-row strong { color: #111827; display: inline-block; min-width: 90px; }
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
  .client-box-details { color: #6B7280; margin-top: 4px; white-space: pre-line; }
  table.details {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  table.details thead th {
    background: #10B981;
    color: #fff;
    text-align: left;
    padding: 10px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  table.details tbody td {
    padding: 10px;
    border-bottom: 1px solid #E5E7EB;
  }
  table.details tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .amount {
    width: 40%;
    margin-left: auto;
    margin-bottom: 25px;
  }
  .amount table { width: 100%; border-collapse: collapse; }
  .amount td { padding: 6px 10px; font-size: 12px; }
  .amount td.label { color: #6B7280; }
  .amount td.val { text-align: right; color: #111827; font-weight: 500; }
  .amount tr.grand td {
    border-top: 2px solid #10B981;
    padding-top: 10px;
    font-size: 14px;
    font-weight: 700;
    color: #10B981;
  }
  .note {
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
      <div class="org-name">${esc(organization?.name ?? '')}</div>
      <div class="org-address">${esc(organization?.address ?? '')}${organization?.email ? '\n' + esc(organization.email) : ''}${organization?.phone ? '\n' + esc(organization.phone) : ''}</div>
    </div>
    <div class="receipt-meta">
      <div class="receipt-title">RECEIPT</div>
      <div class="meta-row"><strong>Receipt #:</strong> ${esc((payment?.id ?? '').slice(0, 8))}</div>
      <div class="meta-row"><strong>Date:</strong> ${fmtDate(payment?.paymentDate)}</div>
      ${invoice?.number ? `<div class="meta-row"><strong>For Invoice:</strong> ${esc(invoice.number)}</div>` : ''}
      ${payment?.transactionId ? `<div class="meta-row"><strong>Transaction:</strong> ${esc(payment.transactionId)}</div>` : ''}
    </div>
  </div>

  <div class="client-box">
    <div class="client-box-label">Received From</div>
    <div class="client-box-name">${esc(client?.company ?? '')}</div>
    <div class="client-box-details">${esc([client?.address, client?.city, client?.country].filter(Boolean).join(', '))}${client?.email ? '\n' + esc(client.email) : ''}</div>
  </div>

  <table class="details">
    <thead>
      <tr>
        <th>Description</th>
        <th>Payment Mode</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(invoice?.number ? `Payment for Invoice ${invoice.number}` : 'Payment')}</td>
        <td>${esc(mode)}</td>
      </tr>
    </tbody>
  </table>

  <div class="amount">
    <table>
      <tr class="grand"><td class="label">Amount Paid</td><td class="val">${fmtMoney(payment?.amount, currency)}</td></tr>
    </table>
  </div>

  ${payment?.note ? `<div class="note"><strong>Note:</strong> ${esc(payment.note)}</div>` : ''}

  <div class="footer">
    <strong>Thank you for your payment</strong>
  </div>
</div>
</body>
</html>`;
}
