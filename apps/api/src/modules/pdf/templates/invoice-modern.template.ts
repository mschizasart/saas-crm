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
      (it, idx) => `
      <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#F8FAFC'};">
        <td style="padding:12px 16px;border:none;color:#334155;">${esc(it.description)}</td>
        <td style="padding:12px 16px;border:none;text-align:right;color:#334155;">${Number(it.quantity).toFixed(2)}</td>
        <td style="padding:12px 16px;border:none;text-align:right;color:#334155;">${fmtMoney(it.unitPrice, currency)}</td>
        <td style="padding:12px 16px;border:none;text-align:right;color:#334155;">${Number(it.taxRate ?? 0).toFixed(2)}%</td>
        <td style="padding:12px 16px;border:none;text-align:right;font-weight:600;color:#0F172A;">${fmtMoney(Number(it.quantity) * Number(it.unitPrice), currency)}</td>
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
    font-family: 'Inter', 'Segoe UI', -apple-system, Roboto, Arial, sans-serif;
    color: #1E293B;
    font-size: 12px;
    line-height: 1.6;
    background: #fff;
  }
</style>
</head>
<body>
<div style="display:flex;min-height:100%;">
  <!-- Accent bar -->
  <div style="width:6px;background:linear-gradient(180deg,#6366F1,#8B5CF6,#A78BFA);flex-shrink:0;"></div>

  <div style="flex:1;padding:40px 40px 30px 34px;">
    <!-- Large invoice number -->
    <div style="margin-bottom:36px;">
      <div style="font-size:42px;font-weight:800;color:#6366F1;letter-spacing:-1px;line-height:1;">INVOICE</div>
      <div style="font-size:18px;font-weight:600;color:#475569;margin-top:6px;">#${esc(invoice.number)}</div>
    </div>

    <!-- Two-column org / client -->
    <div style="display:flex;justify-content:space-between;margin-bottom:32px;">
      <div style="flex:1;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#94A3B8;margin-bottom:6px;">From</div>
        <div style="font-size:14px;font-weight:700;color:#0F172A;">${esc(organization?.name ?? '')}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px;white-space:pre-line;">${esc(organization?.address ?? '')}${organization?.email ? '\n' + esc(organization.email) : ''}${organization?.phone ? '\n' + esc(organization.phone) : ''}</div>
      </div>
      <div style="flex:1;text-align:right;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#94A3B8;margin-bottom:6px;">Bill To</div>
        <div style="font-size:14px;font-weight:700;color:#0F172A;">${esc(invoice.client?.company ?? '')}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px;white-space:pre-line;">${esc(invoice.client?.address ?? '')}${invoice.client?.email ? '\n' + esc(invoice.client.email) : ''}</div>
      </div>
    </div>

    <!-- Meta row -->
    <div style="display:flex;gap:24px;margin-bottom:28px;padding:12px 16px;background:#F8FAFC;border-radius:8px;">
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;">Issue Date</div>
        <div style="font-size:12px;font-weight:600;color:#334155;margin-top:2px;">${fmtDate(invoice.date)}</div>
      </div>
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;">Due Date</div>
        <div style="font-size:12px;font-weight:600;color:#334155;margin-top:2px;">${fmtDate(invoice.dueDate)}</div>
      </div>
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;">Status</div>
        <div style="font-size:12px;font-weight:600;color:#6366F1;margin-top:2px;">${esc((invoice.status ?? '').toUpperCase())}</div>
      </div>
    </div>

    <!-- Items table -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <thead>
        <tr style="border-bottom:2px solid #E2E8F0;">
          <th style="padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;font-weight:600;">Description</th>
          <th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;font-weight:600;">Qty</th>
          <th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;font-weight:600;">Unit Price</th>
          <th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;font-weight:600;">Tax %</th>
          <th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;font-weight:600;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows || '<tr><td colspan="5" style="text-align:center;color:#CBD5E1;padding:24px;">No items</td></tr>'}
      </tbody>
    </table>

    <!-- Totals box -->
    <div style="margin-left:auto;width:260px;background:#F8FAFC;border-radius:8px;padding:16px;margin-bottom:24px;">
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#64748B;">
        <span>Subtotal</span><span style="color:#334155;font-weight:500;">${fmtMoney(invoice.subtotal, currency)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#64748B;">
        <span>Tax</span><span style="color:#334155;font-weight:500;">${fmtMoney(invoice.tax, currency)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#64748B;">
        <span>Discount</span><span style="color:#334155;font-weight:500;">- ${fmtMoney(invoice.discount, currency)}</span>
      </div>
      <div style="border-top:2px solid #6366F1;margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:#6366F1;">
        <span>Total</span><span>${fmtMoney(invoice.total, currency)}</span>
      </div>
    </div>

    ${invoice.notes ? `<div style="background:#FEFCE8;border-left:3px solid #FACC15;padding:12px 16px;margin-bottom:12px;font-size:11px;color:#713F12;border-radius:0 6px 6px 0;"><strong>Notes:</strong> ${esc(invoice.notes)}</div>` : ''}
    ${invoice.terms ? `<div style="padding:12px 16px;border:1px solid #E2E8F0;border-radius:6px;font-size:11px;color:#64748B;margin-bottom:24px;"><strong>Terms &amp; Conditions:</strong> ${esc(invoice.terms)}</div>` : ''}

    <div style="text-align:center;padding-top:16px;border-top:1px solid #F1F5F9;color:#94A3B8;font-size:11px;">
      <strong style="color:#6366F1;">Thank you for your business</strong>
    </div>
  </div>
</div>
</body>
</html>`;
}
