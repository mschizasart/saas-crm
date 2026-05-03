/* eslint-env browser */
(function () {
  const report = window.__REPORT__;
  if (!report) {
    document.body.innerHTML = '<div class="empty">No report payload — run `pnpm test:all` first.</div>';
    return;
  }

  // ─── meta line ─────────────────────────────────────────────
  document.getElementById('meta').textContent =
    `commit ${report.gitCommit} · last run ${new Date(report.generatedAt).toLocaleString()}`;

  // ─── totals pills ──────────────────────────────────────────
  const t = report.totals;
  const totals = document.getElementById('totals');
  totals.innerHTML = `
    <span class="pill">Total: ${t.total}</span>
    <span class="pill pass">Passed: ${t.passed}</span>
    <span class="pill fail">Failed: ${t.failed}</span>
    <span class="pill skip">Skipped: ${t.skipped}</span>
    <span class="pill">Duration: ${(t.durationMs / 1000).toFixed(2)}s</span>
  `;

  // ─── coverage ──────────────────────────────────────────────
  const cov = document.getElementById('coverage');
  cov.innerHTML = (report.coverage || []).map((c) => {
    const pct = c.pct == null ? null : Math.max(0, Math.min(100, Math.round(c.pct)));
    return `
      <div class="item">
        <span>${c.app}</span>
        <div class="bar"><span style="width:${pct ?? 0}%"></span></div>
        <span>${pct == null ? 'no data' : pct + '%'}</span>
      </div>
    `;
  }).join('') || '<div class="item">No coverage data</div>';

  // ─── tabs by category ──────────────────────────────────────
  const CATEGORIES = ['smoke', 'security', 'contract', 'migration', 'performance', 'unit', 'integration', 'component', 'e2e'];
  const byCat = {};
  for (const c of CATEGORIES) byCat[c] = [];
  for (const s of report.suites) (byCat[s.category] = byCat[s.category] || []).push(s);

  const tabs = document.getElementById('tabs');
  const panels = document.getElementById('panels');
  CATEGORIES.forEach((cat, i) => {
    const suites = byCat[cat] || [];
    const fail = suites.reduce((a, s) => a + (s.failed || 0), 0);
    const total = suites.reduce((a, s) => a + (s.total || 0), 0);

    const btn = document.createElement('button');
    btn.textContent = cat[0].toUpperCase() + cat.slice(1);
    btn.dataset.cat = cat;
    if (i === 0) btn.classList.add('active');
    if (fail > 0) btn.classList.add('has-fail');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = total;
    btn.appendChild(badge);
    tabs.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'panel' + (i === 0 ? ' active' : '');
    panel.dataset.cat = cat;
    panel.appendChild(renderSuites(suites));
    panels.appendChild(panel);
  });

  tabs.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    const cat = e.target.dataset.cat;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === e.target));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.cat === cat));
  });

  // expand/collapse suites
  document.addEventListener('click', (e) => {
    const h = e.target.closest && e.target.closest('.suite-header');
    if (h) h.parentElement.classList.toggle('open');
  });

  function renderSuites(list) {
    const frag = document.createDocumentFragment();
    if (!list.length) {
      const div = document.createElement('div');
      div.className = 'empty';
      div.textContent = 'No results in this category yet.';
      frag.appendChild(div);
      return frag;
    }
    for (const s of list) {
      const wrap = document.createElement('div');
      wrap.className = 'suite' + (s.failed > 0 ? ' open' : '');
      const head = document.createElement('div');
      head.className = 'suite-header';
      const failColour = s.failed > 0 ? 'ko' : 'ok';
      head.innerHTML = `
        <h3>${escape(s.label)} <small style="color:var(--muted)">(${escape(s.suiteId)})</small></h3>
        <div>
          <span class="stats">
            <span class="${failColour}">${s.passed || 0}/${s.total || 0}</span>
            ${s.failed ? `· <span class="ko">${s.failed} failed</span>` : ''}
            ${s.skipped ? `· <span style="color:var(--skip)">${s.skipped} skipped</span>` : ''}
            · ${(s.durationMs / 1000).toFixed(2)}s
            ${s.missing ? '· <span style="color:var(--muted)">no JSON</span>' : ''}
          </span>
          <button class="rerun-btn" disabled title="Start the runner with `runner serve` to enable">Rerun</button>
        </div>
      `;
      wrap.appendChild(head);

      const body = document.createElement('div');
      body.className = 'suite-body';
      const byFile = groupBy(s.tests || [], (t) => t.file);
      const sortedFiles = Object.keys(byFile).sort();
      if (sortedFiles.length === 0 && s.extra) {
        const pre = document.createElement('pre');
        pre.className = 'error';
        pre.textContent = JSON.stringify(s.extra, null, 2);
        body.appendChild(pre);
      } else {
        for (const file of sortedFiles) {
          const fileHeader = document.createElement('div');
          fileHeader.className = 'test';
          fileHeader.style.background = '#1a1f25';
          fileHeader.innerHTML = `<div><strong>${escape(file)}</strong></div>`;
          body.appendChild(fileHeader);
          for (const t of byFile[file]) {
            const row = document.createElement('div');
            row.className = `test ${t.status}`;
            row.innerHTML = `
              <div>
                <span class="name">${escape(t.name)}</span>
                ${t.error ? `<pre class="error">${escape(t.error.message || '')}</pre>` : ''}
              </div>
              <span class="meta">${t.duration ? Math.round(t.duration) + 'ms' : ''}</span>
            `;
            body.appendChild(row);
          }
        }
      }
      wrap.appendChild(body);
      frag.appendChild(wrap);
    }
    return frag;
  }

  function groupBy(arr, keyFn) {
    const out = {};
    for (const item of arr) {
      const k = keyFn(item);
      (out[k] = out[k] || []).push(item);
    }
    return out;
  }

  function escape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
