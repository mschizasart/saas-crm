// Client account statement PDF template.
//
// Design mirrors the invoice template (apps/api/src/modules/pdf/templates/
// invoice.template.ts) — same colour palette (#3B82F6 primary, #F9FAFB
// surface, #6B7280 muted), same font stack, same A4 margins. The only
// structural difference is the body: instead of an items table we show
// opening balance → debit/credit/balance ledger → closing balance.
//
// Inputs:
//   StatementResult (from clients.service.ts) with `organization` injected.
//   Optional `period` strings already-formatted by the caller.

import type { StatementResult } from '../../clients/clients.service';

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

/**
 * Format a number using the currency's decimalPlaces / separators if known,
 * otherwise fall back to a simple `code + N.NN`.
 */
function fmtMoney(
  v: any,
  currency: { code?: string | null; symbol?: string | null } | null | undefined,
): string {
  const n = Number(v ?? 0);
  const fixed = n.toFixed(2);
  if (!currency) return fixed;
  const prefix = currency.code ?? currency.symbol ?? '';
  return `${prefix} ${fixed}`.trim();
}

const TYPE_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  payment: 'Payment',
  credit_note: 'Credit Note',
};

export function renderStatementHtml(statement: StatementResult): string {
  const { client, organization: org, currency, dateRange, transactions } =
    statement;

  const periodLabel =
    dateRange.from && dateRange.to
      ? `${fmtDate(dateRange.from)} — ${fmtDate(dateRange.to)}`
      : dateRange.from
        ? `From ${fmtDate(dateRange.from)}`
        : dateRange.to
          ? `Up to ${fmtDate(dateRange.to)}`
          : 'All time';

  const orgAddressLines = [
    org?.address,
    [org?.city, org?.state, org?.zipCode].filter(Boolean).join(' '),
    org?.country,
    org?.phone,
    org?.website,
  ]
    .filter((s) => s && String(s).trim())
    .map((s) => esc(s))
    .join('<br/>');

  const clientAddressLines = [
    client.address,
    [client.city, client.state, client.zipCode].filter(Boolean).join(' '),
    client.country,
    client.vat ? `VAT: ${client.vat}` : null,
  ]
    .filter((s) => s && String(s).trim())
    .map((s) => esc(s as string))
    .join('<br/>');

  // Opening balance row sits above the transaction body.
  const openingRow = `
    <tr class="opening">
      <td>${fmtDate(dateRange.from)}</td>
      <td></td>
      <td><em>Opening balance</em></td>
      <td class="num"></td>
      <td class="num"></td>
      <td class="num">${fmtMoney(statement.openingBalance, currency)}</td>
    </tr>`;

  const txRows = transactions
    .map(
      (t) => `
    <tr>
      <td>${fmtDate(t.date)}</td>
      <td>${esc(t.reference)}</td>
      <td>
        <span class="badge badge-${t.type}">${TYPE_LABEL[t.type] ?? t.type}</span>
        ${t.description && t.description !== TYPE_LABEL[t.type]
          ? ` <span class="muted">${esc(t.description)}</span>`
          : ''}
      </td>
      <td class="num">${t.debit ? fmtMoney(t.debit, currency) : ''}</td>
      <td class="num">${t.credit ? fmtMoney(t.credit, currency) : ''}</td>
      <td class="num">${fmtMoney(t.balance, currency)}</td>
    </tr>`,
    )
    .join('');

  const emptyRow =
    transactions.length === 0
      ? `<tr><td colspan="6" style="text-align:center;color:#9CA3AF;padding:20px;">No transactions in this period</td></tr>`
      : '';

  const skipFootnote =
    statement.skipCount > 0
      ? `<p class="footnote">${statement.skipCount} transaction${
          statement.skipCount === 1 ? '' : 's'
        } in other currencies ${
          statement.skipCount === 1 ? 'is' : 'are'
        } not shown.</p>`
      : '';

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
  .org-logo {
    width: 80px; height: 80px;
    background: #EFF6FF;
    border: 1px dashed #3B82F6;
    display: flex; align-items: center; justify-content: center;
    color: #3B82F6; font-weight: 600;
    margin-bottom: 10px;
    overflow: hidden;
  }
  .org-logo img { max-width: 100%; max-height: 100%; }
  .org-name { font-size: 20px; font-weight: 700; color: #111827; }
  .org-address { color: #6B7280; font-size: 11px; margin-top: 4px; }
  .statement-meta { text-align: right; }
  .statement-title {
    font-size: 28px;
    font-weight: 800;
    color: #3B82F6;
    letter-spacing: 1px;
    margin: 0 0 8px 0;
  }
  .meta-row { margin-top: 6px; font-size: 11px; color: #6B7280; }
  .meta-row strong { color: #111827; display: inline-block; min-width: 70px; }
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
  .client-box-details { color: #6B7280; margin-top: 4px; font-size: 11px; }
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
    padding: 9px 10px;
    border-bottom: 1px solid #E5E7EB;
    vertical-align: top;
  }
  table.entries tbody td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  table.entries tbody tr.opening {
    background: #EFF6FF;
    font-weight: 600;
  }
  table.entries tbody tr.opening td { border-bottom: 2px solid #3B82F6; }
  .badge {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.3px;
  }
  .badge-invoice { background: #FEF3C7; color: #92400E; }
  .badge-payment { background: #D1FAE5; color: #065F46; }
  .badge-credit_note { background: #DBEAFE; color: #1E40AF; }
  .muted { color: #6B7280; font-size: 11px; }
  .summary {
    width: 45%;
    margin-left: auto;
    margin-bottom: 25px;
  }
  .summary table { width: 100%; border-collapse: collapse; }
  .summary td { padding: 6px 10px; font-size: 12px; }
  .summary td.label { color: #6B7280; }
  .summary td.val {
    text-align: right;
    color: #111827;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .summary tr.grand td {
    border-top: 2px solid #3B82F6;
    padding-top: 10px;
    font-size: 14px;
    font-weight: 700;
    color: #3B82F6;
  }
  .footnote {
    margin-top: 15px;
    padding: 8px 12px;
    background: #FEF3C7;
    border-left: 3px solid #F59E0B;
    color: #92400E;
    font-size: 10px;
    border-radius: 4px;
  }
  .footer {
    text-align: center;
    padding-top: 20px;
    border-top: 1px solid #E5E7EB;
    color: #6B7280;
    font-size: 11px;
    margin-top: 30px;
  }
  .footer strong { color: #3B82F6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="org">
      <div class="org-logo">${
        org?.logo
          ? `<img src="${esc(org.logo)}" alt="logo" />`
          : 'LOGO'
      }</div>
      <div class="org-name">${esc(org?.name ?? '')}</div>
      <div class="org-address">${orgAddressLines}</div>
    </div>
    <div class="statement-meta">
      <div class="statement-title">STATEMENT</div>
      <div class="meta-row"><strong>Issued:</strong> ${fmtDate(new Date())}</div>
      <div class="meta-row"><strong>Period:</strong> ${esc(periodLabel)}</div>
      ${currency ? `<div class="meta-row"><strong>Currency:</strong> ${esc(currency.code ?? currency.name ?? '')}</div>` : ''}
    </div>
  </div>

  <div class="client-box">
    <div class="client-box-label">Statement of Account For</div>
    <div class="client-box-name">${esc(client.company)}</div>
    <div class="client-box-details">${clientAddressLines}</div>
  </div>

  <table class="entries">
    <thead>
      <tr>
        <th>Date</th>
        <th>Reference</th>
        <th>Description</th>
        <th class="num">Debit</th>
        <th class="num">Credit</th>
        <th class="num">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${openingRow}
      ${txRows}
      ${emptyRow}
    </tbody>
  </table>

  <div class="summary">
    <table>
      <tr><td class="label">Opening Balance</td><td class="val">${fmtMoney(statement.openingBalance, currency)}</td></tr>
      <tr><td class="label">Total Debits</td><td class="val">${fmtMoney(statement.totals.debit, currency)}</td></tr>
      <tr><td class="label">Total Credits</td><td class="val">${fmtMoney(statement.totals.credit, currency)}</td></tr>
      <tr class="grand"><td class="label">Closing Balance</td><td class="val">${fmtMoney(statement.closingBalance, currency)}</td></tr>
    </table>
  </div>

  ${skipFootnote}

  <div class="footer">
    <strong>Thank you for your business</strong><br/>
    <span class="muted">Please remit any outstanding balance at your earliest convenience.</span>
  </div>
</div>
</body>
</html>`;
}
