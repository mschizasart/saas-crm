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

const fmtDateTime = (d: any): string => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return '—';
  }
};

const fmtMoney = (v: any, currency = 'USD'): string => {
  const n = Number(v ?? 0);
  return `${currency} ${n.toFixed(2)}`;
};

/**
 * Render a proposal PDF.
 *
 * `signature` (optional) carries the e-signature payload assembled by the
 * SignaturesService:
 *   { signerName, signerEmail, signedAt, ipAddress, imageDataUrl }
 *
 * When a signature is present (and not just a placeholder), a signature
 * block is appended at the bottom of the document. When the proposal has a
 * `signedAt` timestamp but no payload, only the timestamp is shown.
 */
export function renderProposalHtml(
  proposal: any,
  organization: any,
  signature?: {
    signerName?: string;
    signerEmail?: string;
    signedAt?: any;
    ipAddress?: string;
    imageDataUrl?: string | null;
  } | null,
): string {
  const currency = proposal.currency ?? 'USD';
  const isSigned = !!(signature?.imageDataUrl || proposal.signedAt);

  const signatureBlock = isSigned
    ? `
  <div class="signature-block">
    <div class="sig-heading">Signed by Client</div>
    <div class="sig-body">
      ${
        signature?.imageDataUrl
          ? `<img class="sig-img" src="${esc(signature.imageDataUrl)}" alt="Signature" />`
          : '<div class="sig-line"></div>'
      }
      <div class="sig-meta">
        <div><strong>${esc(signature?.signerName ?? '')}</strong></div>
        ${signature?.signerEmail ? `<div>${esc(signature.signerEmail)}</div>` : ''}
        <div>Signed: ${esc(fmtDateTime(signature?.signedAt ?? proposal.signedAt))}</div>
        ${signature?.ipAddress ? `<div>IP: ${esc(signature.ipAddress)}</div>` : ''}
      </div>
    </div>
  </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Proposal — ${esc(proposal.subject)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
    color: #1f2937;
    font-size: 12px;
    margin: 0;
    padding: 0;
    line-height: 1.6;
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
  .proposal-meta { text-align: right; }
  .proposal-title {
    font-size: 28px;
    font-weight: 800;
    color: #3B82F6;
    letter-spacing: 1px;
    margin: 0 0 8px 0;
  }
  .meta-row { margin-top: 6px; font-size: 11px; color: #6B7280; }
  .meta-row strong { color: #111827; display: inline-block; min-width: 80px; }
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
  .subject {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid #E5E7EB;
  }
  .content {
    margin-bottom: 25px;
    font-size: 12px;
    line-height: 1.7;
    color: #374151;
  }
  .total-box {
    background: #EFF6FF;
    border: 1px solid #3B82F6;
    border-radius: 6px;
    padding: 15px 20px;
    display: inline-block;
    margin-bottom: 25px;
  }
  .total-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #6B7280;
    margin-bottom: 4px;
  }
  .total-value {
    font-size: 22px;
    font-weight: 800;
    color: #3B82F6;
  }
  .signature-block {
    margin-top: 35px;
    padding: 18px 20px;
    border: 1px solid #3B82F6;
    border-radius: 6px;
    background: #F8FAFC;
    page-break-inside: avoid;
  }
  .sig-heading {
    text-transform: uppercase;
    font-size: 10px;
    color: #6B7280;
    letter-spacing: 1px;
    margin-bottom: 12px;
    font-weight: 600;
  }
  .sig-body { display: flex; gap: 24px; align-items: center; }
  .sig-img { max-height: 80px; max-width: 260px; }
  .sig-line { border-bottom: 1px solid #111; width: 240px; height: 40px; }
  .sig-meta { font-size: 11px; color: #374151; line-height: 1.6; }
  .sig-meta strong { color: #111827; }
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
    <div class="proposal-meta">
      <div class="proposal-title">PROPOSAL</div>
      <div class="meta-row"><strong>Date:</strong> ${fmtDate(proposal.dateCreated ?? proposal.createdAt)}</div>
      <div class="meta-row"><strong>Status:</strong> ${esc((proposal.status ?? '').toUpperCase())}</div>
      ${proposal.openTill ? `<div class="meta-row"><strong>Valid Until:</strong> ${fmtDate(proposal.openTill)}</div>` : ''}
    </div>
  </div>

  ${proposal.client ? `
  <div class="client-box">
    <div class="client-box-label">Prepared For</div>
    <div class="client-box-name">${esc(proposal.client.company)}</div>
  </div>
  ` : ''}

  <div class="subject">${esc(proposal.subject)}</div>

  <div class="content">${proposal.content ?? '<p>No content</p>'}</div>

  ${proposal.total != null ? `
  <div class="total-box">
    <div class="total-label">Total Value</div>
    <div class="total-value">${fmtMoney(proposal.total, currency)}</div>
  </div>
  ` : ''}

  ${signatureBlock}

  <div class="footer">
    <strong>Thank you for your consideration</strong>
  </div>
</div>
</body>
</html>`;
}
