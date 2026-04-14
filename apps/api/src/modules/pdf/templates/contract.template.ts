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

export function renderContractHtml(contract: any, organization: any): string {
  const signed = !!contract.signedAt;
  const sigImg = contract.signatureData
    ? `<img src="${contract.signatureData}" alt="Signature" style="max-height:80px;max-width:250px;" />`
    : '<div style="border-bottom:1px solid #111;width:250px;height:40px;"></div>';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Contract — ${esc(contract.subject)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    color: #1f2937;
    font-size: 12px;
    line-height: 1.7;
    margin: 0;
    padding: 0;
  }
  .header {
    text-align: center;
    border-bottom: 3px double #3B82F6;
    padding-bottom: 15px;
    margin-bottom: 25px;
  }
  .org-name {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .title {
    font-size: 24px;
    font-weight: 800;
    text-align: center;
    color: #111827;
    margin: 20px 0 5px;
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .subject {
    text-align: center;
    font-size: 14px;
    color: #3B82F6;
    font-style: italic;
    margin-bottom: 30px;
  }
  .parties {
    display: flex;
    justify-content: space-between;
    gap: 30px;
    margin-bottom: 30px;
  }
  .party {
    flex: 1;
    background: #F9FAFB;
    padding: 15px;
    border-left: 3px solid #3B82F6;
  }
  .party-label {
    text-transform: uppercase;
    font-size: 10px;
    color: #6B7280;
    letter-spacing: 1px;
    margin-bottom: 6px;
  }
  .party-name { font-weight: 700; font-size: 13px; color: #111827; }
  .party-details { color: #6B7280; margin-top: 4px; font-size: 11px; }
  .content {
    margin: 25px 0;
    text-align: justify;
    font-size: 12px;
    color: #1f2937;
  }
  .content p { margin: 0 0 10px 0; }
  .meta-row { font-size: 11px; color: #6B7280; margin: 4px 0; }
  .meta-row strong { color: #111827; }
  .signatures {
    display: flex;
    justify-content: space-between;
    gap: 40px;
    margin-top: 50px;
    padding-top: 25px;
    border-top: 1px solid #E5E7EB;
  }
  .sig-block { flex: 1; }
  .sig-label {
    text-transform: uppercase;
    font-size: 10px;
    color: #6B7280;
    letter-spacing: 1px;
    margin-bottom: 15px;
  }
  .sig-image { margin-bottom: 5px; min-height: 40px; }
  .sig-line {
    border-bottom: 1px solid #111827;
    height: 1px;
    margin-bottom: 5px;
  }
  .sig-name { font-weight: 600; font-size: 11px; color: #111827; }
  .sig-email { font-size: 10px; color: #6B7280; }
  .sig-date { font-size: 10px; color: #6B7280; margin-top: 4px; }
  .footer {
    text-align: center;
    padding-top: 20px;
    margin-top: 30px;
    border-top: 1px solid #E5E7EB;
    color: #9CA3AF;
    font-size: 10px;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="org-name">${esc(organization?.name ?? '')}</div>
  </div>

  <div class="title">Contract Agreement</div>
  <div class="subject">${esc(contract.subject ?? '')}</div>

  <div class="parties">
    <div class="party">
      <div class="party-label">Service Provider</div>
      <div class="party-name">${esc(organization?.name ?? '')}</div>
      <div class="party-details">${esc(organization?.address ?? '')}</div>
      ${organization?.email ? `<div class="party-details">${esc(organization.email)}</div>` : ''}
    </div>
    <div class="party">
      <div class="party-label">Client</div>
      <div class="party-name">${esc(contract.client?.company ?? '')}</div>
      <div class="party-details">${esc(contract.client?.address ?? '')}</div>
      ${contract.client?.email ? `<div class="party-details">${esc(contract.client.email)}</div>` : ''}
    </div>
  </div>

  <div class="meta-row"><strong>Type:</strong> ${esc(contract.type ?? '—')}</div>
  <div class="meta-row"><strong>Start Date:</strong> ${fmtDate(contract.startDate)}</div>
  <div class="meta-row"><strong>End Date:</strong> ${fmtDate(contract.endDate)}</div>
  ${contract.value ? `<div class="meta-row"><strong>Value:</strong> ${esc(contract.value)}</div>` : ''}

  <div class="content">
    ${contract.content ?? '<p><em>No content provided.</em></p>'}
  </div>

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-label">For the Service Provider</div>
      <div class="sig-image"><div class="sig-line"></div></div>
      <div class="sig-name">${esc(organization?.name ?? '')}</div>
      <div class="sig-date">Date: _______________</div>
    </div>
    <div class="sig-block">
      <div class="sig-label">For the Client</div>
      <div class="sig-image">${sigImg}</div>
      ${signed ? `<div class="sig-name">${esc(contract.signedByName ?? '')}</div>` : '<div class="sig-line"></div>'}
      ${signed ? `<div class="sig-email">${esc(contract.signedByEmail ?? '')}</div>` : ''}
      <div class="sig-date">Date: ${signed ? fmtDate(contract.signedAt) : '_______________'}</div>
    </div>
  </div>

  <div class="footer">
    This document is generated electronically and is legally binding once signed by both parties.
  </div>
</body>
</html>`;
}
