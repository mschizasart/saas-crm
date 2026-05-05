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
  const CATEGORIES = ['smoke', 'security', 'contract', 'migration', 'performance', 'unit', 'integration', 'component', 'e2e', 'visual', 'mutation'];
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
    if (cat === 'mutation') {
      panel.appendChild(renderMutation(suites));
    } else {
      panel.appendChild(renderSuites(suites));
    }
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

  // ─── Mutation tab (Stryker) ──────────────────────────────────────
  function renderMutation(list) {
    const frag = document.createDocumentFragment();
    if (!list.length) {
      const div = document.createElement('div');
      div.className = 'empty';
      div.textContent = 'No mutation results yet — run `pnpm --filter api test:mutation` (slow, 15-25min).';
      frag.appendChild(div);
      return frag;
    }

    for (const s of list) {
      const extra = s.extra || {};
      const score = typeof extra.mutationScore === 'number' ? extra.mutationScore : null;
      const totals = extra.totals || {};
      const thresholds = extra.thresholds || { high: 80, low: 60, break: 50 };
      const perFile = Array.isArray(extra.perFile) ? extra.perFile : [];
      const survived = Array.isArray(extra.survived) ? extra.survived : [];
      const htmlReportPath = extra.htmlReportPath || '../.mutation/api/index.html';

      const wrap = document.createElement('div');
      wrap.className = 'suite open';

      // ── Header with overall score + open-detailed-report button
      const head = document.createElement('div');
      head.className = 'suite-header';
      const band = score == null
        ? 'na'
        : score >= thresholds.high
          ? 'high'
          : score >= thresholds.low
            ? 'low'
            : 'break';
      const bandColour = band === 'high' ? 'ok' : band === 'low' ? 'skip' : 'ko';
      head.innerHTML = `
        <h3>${escape(s.label)} <small style="color:var(--muted)">(${escape(s.suiteId)})</small></h3>
        <div>
          <span class="stats">
            <span class="${bandColour}">score: ${score == null ? 'n/a' : score + '%'}</span>
            · killed ${totals.killed ?? 0}
            · survived ${totals.survived ?? 0}
            · no-cov ${totals.noCoverage ?? 0}
            · timeout ${totals.timeout ?? 0}
            · ${(s.durationMs / 1000).toFixed(2)}s
            ${s.missing ? '· <span style="color:var(--muted)">no JSON</span>' : ''}
          </span>
        </div>
      `;
      wrap.appendChild(head);

      const body = document.createElement('div');
      body.className = 'suite-body';

      // ── Banner with thresholds + open-detailed-report
      const banner = document.createElement('div');
      banner.className = 'mutation-banner';
      banner.innerHTML = `
        <div class="mutation-score-block">
          <div class="mutation-score-num ${bandColour}">${score == null ? 'n/a' : score + '%'}</div>
          <div class="mutation-score-label">overall mutation score</div>
        </div>
        <div class="mutation-thresholds">
          <div>thresholds: <span class="ok">high &ge; ${thresholds.high}%</span> · <span class="skip">low &ge; ${thresholds.low}%</span> · <span class="ko">break &lt; ${thresholds.break}%</span></div>
          <div style="color:var(--muted);margin-top:4px;">total mutants: ${totals.totalMutants ?? 0} (${totals.totalValid ?? 0} valid · ${totals.compileError ?? 0} compile-err · ${totals.runtimeError ?? 0} runtime-err · ${totals.ignored ?? 0} ignored)</div>
        </div>
        <a class="mutation-html-link" href="${escape(htmlReportPath)}" target="_blank">Open detailed HTML report &rarr;</a>
      `;
      body.appendChild(banner);

      // ── Per-file score table
      if (perFile.length) {
        const tableWrap = document.createElement('div');
        tableWrap.className = 'mutation-table-wrap';
        let tableHtml = `
          <h4 style="margin:16px 16px 8px;font-size:13px;">Per-file mutation scores</h4>
          <table class="mutation-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Score</th>
                <th>Killed</th>
                <th>Survived</th>
                <th>No&nbsp;cov</th>
                <th>Timeout</th>
                <th>Valid</th>
              </tr>
            </thead>
            <tbody>
        `;
        for (const f of perFile) {
          const rowBand = f.band === 'high' ? 'ok' : f.band === 'low' ? 'skip' : f.band === 'break' ? 'ko' : '';
          tableHtml += `
            <tr>
              <td class="mutation-file">${escape(f.file)}</td>
              <td class="${rowBand}"><strong>${f.score}%</strong></td>
              <td>${f.killed}</td>
              <td class="${f.survived > 0 ? 'ko' : ''}">${f.survived}</td>
              <td class="${f.noCoverage > 0 ? 'skip' : ''}">${f.noCoverage}</td>
              <td>${f.timeout}</td>
              <td>${f.totalValid}</td>
            </tr>
          `;
        }
        tableHtml += '</tbody></table>';
        tableWrap.innerHTML = tableHtml;
        body.appendChild(tableWrap);
      }

      // ── Survived mutations list
      if (survived.length) {
        const sec = document.createElement('div');
        sec.className = 'mutation-survived';
        let html = `<h4 style="margin:16px 16px 8px;font-size:13px;">Survived / no-coverage mutations (${survived.length}${survived.length >= 200 ? '+ truncated' : ''})</h4>`;
        for (const m of survived) {
          html += `
            <div class="mutation-row">
              <div class="mutation-row-meta">
                <span class="ko">${escape(m.status)}</span>
                · <strong>${escape(m.mutator)}</strong>
                · <span style="color:var(--muted)">${escape(m.file)}:${m.line}:${m.column}</span>
              </div>
              <pre class="mutation-diff"><span class="diff-orig">- ${escape(m.original)}</span>
<span class="diff-mut">+ ${escape(m.replacement)}</span></pre>
            </div>
          `;
        }
        sec.innerHTML = html;
        body.appendChild(sec);
      } else if (perFile.length) {
        const ok = document.createElement('div');
        ok.className = 'empty';
        ok.style.color = 'var(--pass)';
        ok.textContent = 'No surviving mutations — every mutation was killed by the unit suite.';
        body.appendChild(ok);
      }

      wrap.appendChild(body);
      frag.appendChild(wrap);
    }
    return frag;
  }
})();
