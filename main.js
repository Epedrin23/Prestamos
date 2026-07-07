/* ═══════════════════════════════════════════════════════
   LIBRETA v1 — App principal
   (usa logic.js, supabase-client.js y reports.js, ya cargados)
═══════════════════════════════════════════════════════ */

let chartInteres = null;
let chartEstado = null;

function themeVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function renderCharts(loans, payments) {
  const months = [];
  const byMonth = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const lbl = d.toLocaleString('es-ES', { month: 'short' });
    months.push({ key, lbl }); byMonth[key] = 0;
  }
  payments.filter(p => p.type === 'interest').forEach(p => {
    const k = (p.date || '').slice(0, 7);
    if (byMonth[k] !== undefined) byMonth[k] += p.amount;
  });
  const mLabels = months.map(m => m.lbl);
  const mData = months.map(m => +byMonth[m.key].toFixed(2));
  $('chartInteresVal').textContent = money(mData.reduce((s, v) => s + v, 0));

  const dark = document.documentElement.dataset.theme === 'dark';
  const inkMuted = themeVar('--ink-muted', '#667085');
  const ink = themeVar('--ink', '#1B2A3C');
  const gridColor = dark ? 'rgba(255,255,255,0.07)' : 'rgba(27,42,60,0.07)';
  const barFaint = dark ? 'rgba(237,238,240,.28)' : 'rgba(27,42,60,.16)';

  if (chartInteres) chartInteres.destroy();
  chartInteres = new Chart($('chartInteres'), {
    type: 'bar',
    data: {
      labels: mLabels,
      datasets: [{
        label: 'Interés', data: mData,
        backgroundColor: mData.map((_, i) => i === mData.length - 1 ? ink : barFaint),
        borderRadius: 4, borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + money(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: inkMuted, font: { size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: inkMuted, font: { size: 10 }, callback: v => '$' + v } } }
      }
  });

  const activeLoans = loans.filter(l => !l.isClosed);
  const ok = activeLoans.filter(l => loanStatus(l, payments) === 'ok').length;
  const warning = activeLoans.filter(l => loanStatus(l, payments) === 'warning').length;
  const overdue = activeLoans.filter(l => loanStatus(l, payments) === 'overdue').length;
  const done = loans.filter(l => l.isClosed).length;
  const lbls = ['Al día', 'Próximo', 'Vencido', 'Saldado'];
  const vals = [ok, warning, overdue, done];
  const cols = [themeVar('--money', '#1F6F50'), themeVar('--gold', '#8A5A0B'), themeVar('--rust', '#9C3F27'), themeVar('--gray', '#667085')];

  $('chartEstadoLegend').innerHTML = lbls.map((l, i) =>
    `<span style="display:flex;align-items:center;gap:4px">
      <span style="width:8px;height:8px;border-radius:2px;background:${cols[i]};flex-shrink:0"></span>
      <span style="color:var(--ink-muted)">${l} (${vals[i]})</span>
    </span>`).join('');

  if (chartEstado) chartEstado.destroy();
  chartEstado = new Chart($('chartEstado'), {
    type: 'doughnut',
    data: { labels: lbls, datasets: [{ data: vals, backgroundColor: cols, borderWidth: 0, hoverOffset: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw}` } } }
    }
  });
}

/* ══════════════════════════════
   App
══════════════════════════════ */
const App = {
  activeDetail: null,
  activeClient: null,
  payTarget: null,
  capitalTarget: null,
  editPayTarget: null,
  currentFilter: 'all',

  async init() {
    UI.initTheme();

    if (DB.mode === 'local') {
      $('loginLocalNote').style.display = 'flex';
      $('localModeBanner').style.display = 'flex';
    }

    $('loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const u = $('lu').value.trim();
      const p = $('lp').value.trim();
      $('loginErr').style.display = 'none';
      const res = await DB.auth.login(u, p);
      if (res.ok) await this._enterApp();
      else { $('loginErr').style.display = 'block'; $('lp').value = ''; }
    });

    ['fAmount', 'fRate', 'fFreq'].forEach(id => $(id).addEventListener('input', () => this.updateProjection()));
    $('fFreq').addEventListener('change', () => this.updateProjection());
    $('searchInp').addEventListener('input', () => this.render());
    $('mineToggle').addEventListener('change', () => this.render());
    UI.initFilterBar();

    ['modalNew', 'modalDetail', 'modalPay', 'modalCapital', 'modalCalc', 'modalMora', 'modalClient', 'modalEditPay'].forEach(id =>
      $(id).addEventListener('click', e => { if (e.target === $(id)) UI.closeModal(id); })
    );

    document.addEventListener('click', e => {
      const menu = $('moreMenu');
      if (menu.style.display === 'block' && !e.target.closest('#moreMenu') && !e.target.closest('#btnMoreToggle')) {
        menu.style.display = 'none';
      }
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    const session = await DB.auth.restoreSession();
    if (session) await this._enterApp();
  },

  async _enterApp() {
    try {
      await DB.refresh();
    } catch (err) {
      console.error(err);
      UI.toast('No se pudo conectar a la base de datos. Revisa CONFIG en supabase-client.js', 'rust');
      return;
    }
    $('loginScreen').style.display = 'none';
    $('app').style.display = 'block';
    $('userLabel').textContent = DB.currentUser.name;
    this.render();
  },

  async logout() {
    await DB.auth.logout();
    location.reload();
  },

  /* ── Render principal ── */
  render() {
    const loans = DB.cache.loans;
    const q = ($('searchInp').value || '').toLowerCase();
    const mineOnly = $('mineToggle').checked;

    let items = loans.map(l => ({ loan: l, client: DB.getClient(l.clientId) })).filter(x => x.client);
    if (q) items = items.filter(({ client }) => client.name.toLowerCase().includes(q) || (client.phone || '').toLowerCase().includes(q));
    if (this.currentFilter !== 'all') {
      items = items.filter(({ loan }) => (loan.isClosed ? 'done' : loanStatus(loan, DB.cache.payments)) === this.currentFilter);
    }
    if (mineOnly && DB.currentUser) items = items.filter(({ loan }) => loan.createdBy === DB.currentUser.name);

    // KPIs sobre TODOS los préstamos (no solo los filtrados en pantalla)
    const active = loans.filter(l => !l.isClosed);
    $('kClients').textContent = DB.cache.clients.length;
    $('kActive').textContent = active.length;
    $('kCapital').textContent = money(active.reduce((s, l) => s + loanOutstanding(l, DB.cache.payments), 0));
    $('kInterest').textContent = money(active.reduce((s, l) => {
      const c = loanCuota(l, DB.cache.payments);
      return s + (l.freq === 'quincenal' ? c * 2 : c);
    }, 0));

    renderCharts(loans, DB.cache.payments);
    this._renderAlerts(loans);

    const tbody = $('clientTbody');
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:44px;color:var(--ink-muted)">${
        q || this.currentFilter !== 'all' ? 'Sin resultados para este filtro' : 'Sin préstamos — presiona "+ Nuevo Préstamo"'
      }</td></tr>`;
      return;
    }

    const frag = document.createDocumentFragment();
    [...items].reverse().forEach(({ loan, client }) => {
      const status = loan.isClosed ? 'done' : loanStatus(loan, DB.cache.payments);
      const due = loan.isClosed ? null : nextDueDate(loan, DB.cache.payments);
      const diff = due ? daysDiff(due) : null;
      const outstanding = loanOutstanding(loan, DB.cache.payments);
      const cuota = loanCuota(loan, DB.cache.payments);
      const interestPaid = DB.cache.payments.filter(p => p.loanId === loan.id && p.type === 'interest').reduce((s, p) => s + p.amount, 0);
      const pct = loan.amount ? Math.min(100, Math.round((loan.amount - outstanding) / loan.amount * 100)) : 0;

      let badge, tabCls;
      if (loan.isClosed) { badge = '<span class="badge badge-gray">✓ Saldado</span>'; tabCls = 'tab-gray'; }
      else if (status === 'overdue') { badge = '<span class="badge badge-rust">⚠ Vencido</span>'; tabCls = 'tab-rust'; }
      else if (status === 'warning') { badge = '<span class="badge badge-gold">⏰ Próximo</span>'; tabCls = 'tab-gold'; }
      else { badge = '<span class="badge badge-money">● Al día</span>'; tabCls = 'tab-money'; }

      let dueHtml = '—';
      if (!loan.isClosed && due) {
        const abs = Math.abs(diff), ds = abs === 1 ? 'día' : 'días';
        if (diff < 0) dueHtml = `<span class="mono" style="color:var(--rust);font-weight:700">${fmtDate(due)}<br><small>Hace ${abs} ${ds}</small></span>`;
        else if (diff === 0) dueHtml = '<span style="color:var(--gold);font-weight:700">HOY</span>';
        else if (diff <= 3) dueHtml = `<span class="mono" style="color:var(--gold)">${fmtDate(due)}<br><small>En ${diff} ${ds}</small></span>`;
        else dueHtml = `<span class="mono">${fmtDate(due)}</span><br><small style="color:var(--ink-muted)">En ${diff} días</small>`;
      } else if (loan.isClosed) {
        dueHtml = '<span style="color:var(--money);font-size:.78rem;font-weight:600">SOLVENTE</span>';
      }

      const tr = document.createElement('tr');
      tr.className = tabCls;
      tr.innerHTML = `
        <td><div style="display:flex;align-items:center;gap:7px">${badge}</div></td>
        <td>
          <div style="font-weight:700;cursor:pointer" data-client="${loan.clientId}">${esc(client.name)}</div>
          ${loan.note ? `<div style="font-size:.7rem;color:var(--ink-muted);margin-top:2px">${esc(loan.note)}</div>` : ''}
        </td>
        <td class="mono" style="color:var(--ink-muted);font-size:.8rem">${esc(client.phone || '—')}</td>
        <td>
          <div class="mono" style="font-weight:700">${money(loan.amount)}</div>
          <div class="mono" style="font-size:.7rem;color:var(--ink-muted);margin-top:2px">${loan.rate}% · ${loan.freq} · ${money(cuota)}/cuota</div>
        </td>
        <td>${dueHtml}</td>
        <td>
          <div class="mono" style="font-size:.8rem"><span style="color:var(--money);font-weight:700">${money(interestPaid)}</span></div>
          <div class="mono" style="font-size:.7rem;color:var(--ink-muted);margin-top:2px">cap. pend: ${money(outstanding)}</div>
        </td>
        <td style="min-width:92px">
          <div class="mono" style="font-size:.68rem;color:var(--ink-muted);margin-bottom:4px">${pct}%</div>
          <div class="prog"><div class="prog-fill" style="width:${pct}%"></div></div>
        </td>
        <td>
          <div style="display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap">
            ${!loan.isClosed ? `<button class="btn btn-money btn-sm" data-pay="${loan.id}" title="Registrar cuota">💵</button><button class="btn btn-gold btn-sm" data-capital="${loan.id}" title="Abonar capital">🏦</button>` : ''}
            <button class="btn btn-primary btn-sm" data-detail="${loan.id}">Ver</button>
          </div>
        </td>`;
      frag.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(frag);

    tbody.onclick = e => {
      const pay = e.target.closest('[data-pay]');
      const capital = e.target.closest('[data-capital]');
      const detail = e.target.closest('[data-detail]');
      const client = e.target.closest('[data-client]');
      if (pay) App.openPay(pay.dataset.pay);
      else if (capital) App.openCapital(capital.dataset.capital);
      else if (detail) App.openDetail(detail.dataset.detail);
      else if (client) App.openClient(client.dataset.client);
    };
  },

  _renderAlerts(loans) {
    const bar = $('alertBar');
    const urgent = loans
      .filter(l => !l.isClosed && ['overdue', 'warning'].includes(loanStatus(l, DB.cache.payments)))
      .map(l => ({ loan: l, client: DB.getClient(l.clientId) }))
      .filter(x => x.client);
    if (!urgent.length) { bar.style.display = 'none'; return; }
    bar.style.display = 'block';
    bar.innerHTML = urgent.map(({ loan, client }) => {
      const s = loanStatus(loan, DB.cache.payments);
      const due = nextDueDate(loan, DB.cache.payments);
      const diff = daysDiff(due);
      const cuota = loanCuota(loan, DB.cache.payments);
      const cls = s === 'overdue' ? 'tab-rust' : 'tab-gold';
      const msg = s === 'overdue'
        ? `venció hace ${Math.abs(diff)} día${Math.abs(diff) !== 1 ? 's' : ''}`
        : diff === 0 ? 'vence HOY' : `vence en ${diff} día${diff !== 1 ? 's' : ''}`;
      return `<div class="card ${cls}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:6px;font-size:.82rem">
        <span><b>${esc(client.name)}</b> — <span class="mono">${money(cuota)}</span> ${msg}</span>
        <button class="btn btn-ghost btn-sm" style="margin-left:auto" data-alert="${loan.id}">Registrar →</button>
      </div>`;
    }).join('');
    bar.onclick = e => { const b = e.target.closest('[data-alert]'); if (b) App.openPay(b.dataset.alert); };
  },

  updateProjection() {
    const amount = parseFloat($('fAmount').value) || 0;
    const rate = parseFloat($('fRate').value) || 0;
    const freq = $('fFreq').value;
    if (!amount || !rate) { $('projBox').style.display = 'none'; return; }
    const cuota = +(amount * rate / 100).toFixed(2);
    const pm = freq === 'quincenal' ? cuota * 2 : cuota;
    $('pjCuota').textContent = money(cuota);
    $('pj3m').textContent = money(pm * 3);
    $('pj6m').textContent = money(pm * 6);
    $('pj12m').textContent = money(pm * 12);
    $('projBox').style.display = 'block';
  },

  /* ── Guardar préstamo (nuevo, para cliente existente, o renovación) ── */
  async saveLoan() {
    const isExisting = $('rcClientExisting').classList.contains('sel');
    const amount = parseFloat($('fAmount').value);
    const rate = parseFloat($('fRate').value);
    const freq = $('fFreq').value;
    const dModeEl = document.querySelector('input[name="fDateMode"]:checked');
    const dMode = dModeEl ? dModeEl.value : 'interval';
    const loanNote = $('fLoanNote').value.trim();
    const renewFromId = $('renewFromId').value;

    if (!amount || amount <= 0 || !rate || rate <= 0) return UI.toast('Completa monto e interés', 'rust');

    let clientId;
    if (isExisting) {
      clientId = $('fClientSelect').value;
      if (!clientId) return UI.toast('Selecciona un cliente', 'rust');
    } else {
      const name = $('fName').value.trim();
      const phone = $('fPhone').value.trim();
      if (!name || !phone) return UI.toast('Completa nombre y teléfono', 'rust');
      const client = await DB.clients.add({ name, phone, note: '' });
      clientId = client.id;
    }

    const startDate = today();
    const schedule = buildSchedule(startDate, freq, dMode, 24);
    await DB.loans.add({
      clientId, amount, rate, freq, dateMode: dMode, startDate, schedule,
      note: loanNote, isClosed: false, closedAt: null, closedReason: null,
      renewedFrom: renewFromId || null
    });

    if (renewFromId) {
      await DB.loans.update(renewFromId, { isClosed: true, closedAt: today(), closedReason: 'renewed' });
    }

    UI.toast('Préstamo guardado ✓', 'money');
    UI.closeModal('modalNew');
    this.render();
  },

  /* ── Cuota de interés ── */
  openPay(id) {
    const loan = DB.getLoan(id); if (!loan) return;
    const client = DB.getClient(loan.clientId);
    this.payTarget = id;
    const cuota = loanCuota(loan, DB.cache.payments);
    const due = nextDueDate(loan, DB.cache.payments);
    $('payInfo').textContent = `Cliente: ${client?.name || '—'}`;
    $('payAmount').textContent = money(cuota);
    $('payDate').textContent = due ? `Fecha de cobro: ${fmtDate(due)}` : '';
    $('modalPay').style.display = 'flex';
  },

  async confirmPay() {
    const loan = DB.getLoan(this.payTarget); if (!loan) return;
    const cuota = loanCuota(loan, DB.cache.payments);
    const due = nextDueDate(loan, DB.cache.payments);
    await DB.payments.add({ loanId: loan.id, type: 'interest', amount: cuota, date: today(), dueDate: due });
    UI.closeModal('modalPay');
    UI.toast(`Pago de ${money(cuota)} registrado ✓`, 'money');
    if (this.activeDetail === this.payTarget) this.openDetail(this.activeDetail);
    this.render();
  },

  /* ── Abono a capital ── */
  openCapital(id) {
    const loan = DB.getLoan(id); if (!loan) return;
    const client = DB.getClient(loan.clientId);
    this.capitalTarget = id;
    const outstanding = loanOutstanding(loan, DB.cache.payments);
    $('capInfo').textContent = `Cliente: ${client?.name || '—'}`;
    $('capOutstandingVal').textContent = money(outstanding);
    $('capAmountInput').value = outstanding;
    $('capAmountInput').max = outstanding;
    $('modalCapital').style.display = 'flex';
  },

  async confirmCapital() {
    const loan = DB.getLoan(this.capitalTarget); if (!loan) return;
    const outstanding = loanOutstanding(loan, DB.cache.payments);
    let amt = parseFloat($('capAmountInput').value);
    if (!amt || amt <= 0) return UI.toast('Ingresa un monto válido', 'rust');
    if (amt > outstanding + 0.01) amt = outstanding;
    await DB.payments.add({ loanId: loan.id, type: 'capital', amount: amt, date: today() });
    await this._resyncClosed(loan.id);
    UI.closeModal('modalCapital');
    UI.toast(`Abono de ${money(amt)} registrado ✓`, 'gold');
    if (this.activeDetail === this.capitalTarget) this.openDetail(this.activeDetail);
    this.render();
  },

  async _resyncClosed(loanId) {
    const loan = DB.getLoan(loanId); if (!loan) return;
    const outstanding = loanOutstanding(loan, DB.cache.payments);
    if (outstanding <= 0.01 && !loan.isClosed) {
      await DB.loans.update(loanId, { isClosed: true, closedAt: today(), closedReason: 'paid' });
    } else if (outstanding > 0.01 && loan.isClosed && loan.closedReason !== 'renewed') {
      await DB.loans.update(loanId, { isClosed: false, closedAt: null, closedReason: null });
    }
  },

  /* ── Detalle de préstamo ── */
  openDetail(id) {
    const loan = DB.getLoan(id); if (!loan) return;
    const client = DB.getClient(loan.clientId);
    this.activeDetail = id;
    const cuota = loanCuota(loan, DB.cache.payments);
    const outstanding = loanOutstanding(loan, DB.cache.payments);
    const interestPaid = DB.cache.payments.filter(p => p.loanId === id && p.type === 'interest').reduce((s, p) => s + p.amount, 0);
    const status = loan.isClosed ? 'done' : loanStatus(loan, DB.cache.payments);
    const due = loan.isClosed ? null : nextDueDate(loan, DB.cache.payments);

    const badge = loan.isClosed ? '<span class="badge badge-gray">Saldado</span>'
      : status === 'overdue' ? '<span class="badge badge-rust">Vencido</span>'
      : status === 'warning' ? '<span class="badge badge-gold">Próximo vencimiento</span>'
      : '<span class="badge badge-money">Al día</span>';

    $('detailHeader').innerHTML = `
      <div style="font-weight:700;font-size:1.02rem">${esc(client?.name || '—')} ${badge}</div>
      <div style="font-size:.76rem;color:var(--ink-muted);margin-top:3px">${esc(client?.phone || '')} · Creado ${fmtDate((loan.createdAt || '').slice(0, 10))} por ${esc(loan.createdBy || '—')}</div>`;

    this._fillDetailTabs(loan, cuota, outstanding, interestPaid, due);
    UI.detailTab(1);
    $('modalDetail').style.display = 'flex';
  },

  _fillDetailTabs(loan, cuota, outstanding, interestPaid, due) {
    const pctCap = loan.amount ? Math.min(100, Math.round((loan.amount - outstanding) / loan.amount * 100)) : 0;
    const paidCount = interestPaymentsOf(loan.id, DB.cache.payments).length;
    const sched = loan.isClosed ? [] : scheduleUpTo(loan, paidCount + 5);

    $('dtab1').innerHTML = `
      <div class="grid grid-cols-2 gap-3 mono" style="margin-bottom:14px">
        <div class="stat"><div class="stat-lbl">Capital Original</div><div class="stat-val">${money(loan.amount)}</div></div>
        <div class="stat"><div class="stat-lbl">Capital Pendiente</div><div class="stat-val" style="color:${outstanding > 0 ? 'var(--gold)' : 'var(--money)'}">${money(outstanding)}</div></div>
        <div class="stat"><div class="stat-lbl">Cuota de Interés Actual</div><div class="stat-val" style="color:var(--money);font-size:1.1rem">${money(cuota)}</div></div>
        <div class="stat"><div class="stat-lbl">Tasa / Frecuencia</div><div class="stat-val" style="font-size:1rem">${loan.rate}% ${loan.freq}</div></div>
        <div class="stat"><div class="stat-lbl">Interés Total Cobrado</div><div class="stat-val" style="color:var(--money);font-size:1.05rem">${money(interestPaid)}</div></div>
        <div class="stat"><div class="stat-lbl">Progreso de Capital</div><div class="stat-val" style="font-size:1rem">${pctCap}%</div></div>
      </div>
      ${loan.note ? `<div style="padding:10px 14px;background:var(--surface2);border-radius:8px;font-size:.8rem;color:var(--ink-muted);margin-bottom:12px">📝 ${esc(loan.note)}</div>` : ''}
      ${!loan.isClosed ? `
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:13px;margin-bottom:14px">
        <div style="font-size:.65rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:9px">Próximas fechas de cobro</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px" class="mono">
          ${sched.slice(paidCount, paidCount + 6).map((dt, i) => {
            const df = daysDiff(dt);
            const col = df < 0 ? 'var(--rust)' : df <= 3 ? 'var(--gold)' : 'var(--ink-muted)';
            return `<span style="padding:4px 9px;background:var(--surface);border:1px solid var(--border);border-radius:7px;font-size:.74rem;color:${col}">${fmtDate(dt)}${i === 0 ? ' ← próxima' : ''}</span>`;
          }).join('')}
        </div>
      </div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${!loan.isClosed
          ? `<button class="btn btn-money" style="flex:1;min-width:120px" onclick="App.openPay('${loan.id}')">💵 Cuota de Interés</button>
             <button class="btn btn-gold" style="flex:1;min-width:120px" onclick="App.openCapital('${loan.id}')">🏦 Abonar Capital</button>
             <button class="btn btn-ghost" style="flex:1;min-width:120px" onclick="UI.openRenew('${loan.id}')">🔄 Renovar</button>`
          : `<div style="width:100%;text-align:center;padding:12px;color:var(--money);font-weight:700">✓ Préstamo saldado${loan.closedReason === 'renewed' ? ' (renovado)' : ''}</div>`}
      </div>`;

    const pays = DB.paymentsOf(loan.id);
    if (!pays.length) {
      $('dtab2').innerHTML = '<div style="text-align:center;padding:36px;color:var(--ink-muted)">Sin pagos registrados aún</div>';
    } else {
      $('dtab2').innerHTML = `
        <div style="overflow-x:auto">
          <table class="tbl">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th></th></tr></thead>
            <tbody>
              ${pays.map(p => `
                <tr>
                  <td class="mono">${fmtDate(p.date)}</td>
                  <td>${p.type === 'interest' ? '<span class="badge badge-money">Interés</span>' : '<span class="badge badge-gold">Capital</span>'}</td>
                  <td class="mono" style="font-weight:700">${money(p.amount)}</td>
                  <td style="text-align:right"><button class="icon-btn" style="width:28px;height:28px" data-editpay="${p.id}">✎</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      $('dtab2').querySelector('tbody').onclick = e => {
        const b = e.target.closest('[data-editpay]'); if (b) App.openEditPayment(b.dataset.editpay);
      };
    }

    $('dtab3').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div><label class="lbl">Nota del préstamo</label><input id="eLoanNote" class="inp" value="${esc(loan.note || '')}"/></div>
        <div style="padding:10px 14px;background:var(--gold-bg);border:1px solid var(--gold-border);border-radius:10px;font-size:.76rem;color:var(--gold)">
          ⚠ El monto, tasa y frecuencia no se pueden editar para no alterar el historial de pagos. Si cambiaron las condiciones, usa "Renovar".
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-rust btn-sm" onclick="App.deleteLoan('${loan.id}')">🗑 Eliminar préstamo</button>
          <button class="btn btn-primary" style="flex:1" onclick="App.saveLoanNote('${loan.id}')">Guardar Cambios</button>
        </div>
      </div>`;
  },

  async saveLoanNote(id) {
    const note = $('eLoanNote').value.trim();
    await DB.loans.update(id, { note });
    UI.toast('Nota actualizada ✓', 'money');
    this.openDetail(id);
    this.render();
  },

  async deleteLoan(id) {
    if (!confirm('¿Eliminar este préstamo y su historial de pagos? No se puede deshacer.')) return;
    await DB.loans.remove(id);
    UI.closeModal('modalDetail');
    UI.toast('Préstamo eliminado', 'rust');
    this.render();
  },

  /* ── Editar / eliminar un pago puntual ── */
  openEditPayment(id) {
    const p = DB.cache.payments.find(x => x.id === id); if (!p) return;
    this.editPayTarget = id;
    $('epAmount').value = p.amount;
    $('epDate').value = p.date;
    $('modalEditPay').style.display = 'flex';
  },

  async saveEditPayment() {
    const p = DB.cache.payments.find(x => x.id === this.editPayTarget); if (!p) return;
    const amount = parseFloat($('epAmount').value);
    const date = $('epDate').value;
    if (!amount || amount <= 0 || !date) return UI.toast('Completa monto y fecha', 'rust');
    await DB.payments.update(p.id, { amount, date });
    if (p.type === 'capital') await this._resyncClosed(p.loanId);
    UI.toast('Pago actualizado ✓', 'money');
    UI.closeModal('modalEditPay');
    if (this.activeDetail === p.loanId) this.openDetail(this.activeDetail);
    this.render();
  },

  async deletePayment() {
    const p = DB.cache.payments.find(x => x.id === this.editPayTarget); if (!p) return;
    if (!confirm('¿Eliminar este pago del historial?')) return;
    const loanId = p.loanId, type = p.type;
    await DB.payments.remove(p.id);
    if (type === 'capital') await this._resyncClosed(loanId);
    UI.toast('Pago eliminado', 'rust');
    UI.closeModal('modalEditPay');
    if (this.activeDetail === loanId) this.openDetail(this.activeDetail);
    this.render();
  },

  /* ── Cliente ── */
  openClient(id) {
    const c = DB.getClient(id); if (!c) return;
    this.activeClient = id;
    $('clientHeader').innerHTML = `<div style="font-weight:700;font-size:1.05rem">${esc(c.name)}</div><div style="font-size:.76rem;color:var(--ink-muted);margin-top:2px">Cliente desde ${fmtDate((c.createdAt || '').slice(0, 10))}</div>`;
    $('cName').value = c.name || ''; $('cPhone').value = c.phone || ''; $('cNote').value = c.note || '';

    const loans = DB.loansOf(id);
    $('clientLoansBody').innerHTML = loans.length ? loans.map(l => {
      const status = l.isClosed ? 'done' : loanStatus(l, DB.cache.payments);
      const outstanding = loanOutstanding(l, DB.cache.payments);
      const badgeCls = status === 'overdue' ? 'badge-rust' : status === 'warning' ? 'badge-gold' : status === 'done' ? 'badge-gray' : 'badge-money';
      const badgeTxt = status === 'overdue' ? 'Vencido' : status === 'warning' ? 'Próximo' : status === 'done' ? 'Saldado' : 'Al día';
      return `<div class="card" style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer" data-openloan="${l.id}">
        <div style="flex:1">
          <div style="display:flex;gap:8px;align-items:center"><span class="badge ${badgeCls}">${badgeTxt}</span><span class="mono" style="font-weight:700">${money(l.amount)}</span><span style="color:var(--ink-muted);font-size:.78rem">${l.rate}% ${l.freq}</span></div>
          <div class="mono" style="font-size:.74rem;color:var(--ink-muted);margin-top:3px">Pendiente: ${money(outstanding)} · Creado ${fmtDate((l.createdAt || '').slice(0, 10))}</div>
        </div>
        <span style="color:var(--ink-faint)">→</span>
      </div>`;
    }).join('') : '<div style="text-align:center;padding:24px;color:var(--ink-muted);font-size:.85rem">Sin préstamos todavía</div>';

    $('clientLoansBody').onclick = e => {
      const el = e.target.closest('[data-openloan]');
      if (el) { UI.closeModal('modalClient'); App.openDetail(el.dataset.openloan); }
    };
    $('modalClient').style.display = 'flex';
  },

  async saveClientEdit() {
    const id = this.activeClient; if (!id) return;
    const name = $('cName').value.trim(), phone = $('cPhone').value.trim(), note = $('cNote').value.trim();
    if (!name) return UI.toast('El nombre es obligatorio', 'rust');
    await DB.clients.update(id, { name, phone, note });
    UI.toast('Cliente actualizado ✓', 'money');
    this.openClient(id);
    this.render();
  },

  async deleteClient() {
    const id = this.activeClient; if (!id) return;
    if (!confirm('¿Eliminar este cliente y TODOS sus préstamos e historial? No se puede deshacer.')) return;
    await DB.clients.remove(id);
    UI.closeModal('modalClient');
    UI.toast('Cliente eliminado', 'rust');
    this.render();
  },

  /* ── Respaldo ── */
  exportBackup() {
    const blob = new Blob([DB.exportBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `libreta_respaldo_${today()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    UI.toast('Respaldo descargado ✓', 'money');
  },

  async importBackup(event) {
    const file = event.target.files[0]; if (!file) return;
    if (!confirm('¿Importar este respaldo? Se combina con tus datos actuales — no se borra nada, solo se agrega o actualiza.')) {
      event.target.value = ''; return;
    }
    try {
      const text = await file.text();
      await DB.importBackup(text);
      UI.toast('Respaldo importado ✓', 'money');
      this.render();
    } catch (err) {
      console.error(err);
      UI.toast('No se pudo leer el archivo de respaldo', 'rust');
    }
    event.target.value = '';
  }
};

/* ══════════════════════════════
   UI Helpers
══════════════════════════════ */
const UI = {
  openNewLoan() {
    ['fName', 'fPhone', 'fAmount', 'fRate', 'fLoanNote'].forEach(id => $(id).value = '');
    $('fFreq').value = 'quincenal';
    $('renewFromId').value = '';
    $('modalNewTitle').textContent = 'Nuevo Préstamo';
    $('projBox').style.display = 'none';
    this.populateClientSelect();
    this.selectClientMode('new');
    this.selectDateMode('interval');
    $('modalNew').style.display = 'flex';
  },

  newLoanForClient() {
    const id = App.activeClient;
    this.closeModal('modalClient');
    this.openNewLoan();
    this.selectClientMode('existing');
    $('fClientSelect').value = id;
  },

  openRenew(loanId) {
    const loan = DB.getLoan(loanId); if (!loan) return;
    const outstanding = loanOutstanding(loan, DB.cache.payments);
    this.closeModal('modalDetail');
    this.openNewLoan();
    $('modalNewTitle').textContent = 'Renovar Préstamo';
    this.selectClientMode('existing');
    $('fClientSelect').value = loan.clientId;
    $('fAmount').value = outstanding;
    $('fRate').value = loan.rate;
    $('fFreq').value = loan.freq;
    this.selectDateMode(loan.dateMode);
    $('renewFromId').value = loanId;
    App.updateProjection();
  },

  populateClientSelect() {
    const sel = $('fClientSelect');
    sel.innerHTML = '<option value="">— Selecciona —</option>' +
      DB.cache.clients.map(c => `<option value="${c.id}">${esc(c.name)}${c.phone ? ' — ' + esc(c.phone) : ''}</option>`).join('');
  },

  selectClientMode(mode) {
    $('rcClientNew').classList.toggle('sel', mode === 'new');
    $('rcClientExisting').classList.toggle('sel', mode === 'existing');
    $('clientNewFields').style.display = mode === 'new' ? '' : 'none';
    $('clientExistingFields').style.display = mode === 'existing' ? '' : 'none';
  },

  closeModal(id) { $(id).style.display = 'none'; },

  selectDateMode(mode) {
    $('rcInterval').classList.toggle('sel', mode === 'interval');
    $('rcPanama').classList.toggle('sel', mode === 'panama');
    $('rcInterval').querySelector('input').checked = mode === 'interval';
    $('rcPanama').querySelector('input').checked = mode === 'panama';
  },

  detailTab(n) {
    [1, 2, 3].forEach(i => {
      const tab = $('dtab' + i), btn = $('dt' + i);
      tab.style.display = i === n ? '' : 'none';
      if (i === n) { btn.className = 'btn btn-sm'; btn.style.background = 'var(--surface)'; btn.style.border = '1px solid var(--border)'; btn.style.color = 'var(--ink)'; }
      else { btn.className = 'btn btn-ghost btn-sm'; btn.style.border = 'none'; }
    });
  },

  initFilterBar() {
    $('filterBar').addEventListener('click', e => {
      const btn = e.target.closest('.pill'); if (!btn) return;
      [...document.querySelectorAll('#filterBar .pill')].forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      App.currentFilter = btn.dataset.filter;
      App.render();
    });
  },

  openMora() {
    const overdue = DB.cache.loans
      .filter(l => !l.isClosed && loanStatus(l, DB.cache.payments) === 'overdue')
      .map(l => ({ loan: l, client: DB.getClient(l.clientId), due: nextDueDate(l, DB.cache.payments) }))
      .filter(x => x.client)
      .sort((a, b) => daysDiff(a.due) - daysDiff(b.due));
    const totalRisk = overdue.reduce((s, x) => s + loanOutstanding(x.loan, DB.cache.payments), 0);

    $('moraTotal').innerHTML = `${overdue.length} préstamo${overdue.length !== 1 ? 's' : ''} vencido${overdue.length !== 1 ? 's' : ''} · Capital en riesgo: <b>${money(totalRisk)}</b>`;
    $('moraBody').innerHTML = overdue.length ? overdue.map(({ loan, client, due }) => {
      const diff = daysDiff(due);
      const cuota = loanCuota(loan, DB.cache.payments);
      return `<div class="card tab-rust" style="padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div>
          <div style="font-weight:700">${esc(client.name)}</div>
          <div class="mono" style="font-size:.74rem;color:var(--ink-muted);margin-top:2px">Venció ${fmtDate(due)} · hace ${Math.abs(diff)} día${Math.abs(diff) !== 1 ? 's' : ''} · cuota ${money(cuota)}</div>
        </div>
        <button class="btn btn-money btn-sm" data-alert="${loan.id}">Registrar</button>
      </div>`;
    }).join('') : '<div style="text-align:center;padding:30px;color:var(--ink-muted)">🎉 No hay préstamos vencidos</div>';

    $('moraBody').onclick = e => {
      const b = e.target.closest('[data-alert]');
      if (b) { UI.closeModal('modalMora'); App.openPay(b.dataset.alert); }
    };
    $('modalMora').style.display = 'flex';
  },

  openCalc() {
    $('cAmount').value = ''; $('cRate').value = ''; $('cFreq').value = 'quincenal';
    $('calcResult').style.display = 'none';
    $('modalCalc').style.display = 'flex';
  },

  calcPreview() {
    const amount = parseFloat($('cAmount').value) || 0;
    const rate = parseFloat($('cRate').value) || 0;
    const freq = $('cFreq').value;
    if (!amount || !rate) { $('calcResult').style.display = 'none'; return; }
    const cuota = +(amount * rate / 100).toFixed(2);
    const pm = freq === 'quincenal' ? cuota * 2 : cuota;
    $('cResCuota').textContent = money(cuota);
    $('cResMes').textContent = money(pm);
    $('cRes3m').textContent = money(pm * 3);
    $('cRes6m').textContent = money(pm * 6);
    $('cRes12m').textContent = money(pm * 12);
    $('calcResult').style.display = 'block';
  },

  calcToNew() {
    const amount = $('cAmount').value, rate = $('cRate').value, freq = $('cFreq').value;
    this.closeModal('modalCalc');
    this.openNewLoan();
    if (amount) $('fAmount').value = amount;
    if (rate) $('fRate').value = rate;
    $('fFreq').value = freq;
    App.updateProjection();
  },

  toast(msg, type) {
    const cols = { money: 'var(--money)', rust: 'var(--rust)', gold: 'var(--gold)', gray: 'var(--gray)' };
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.borderLeftColor = cols[type] || cols.money;
    t.textContent = msg;
    $('toastRoot').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  },

  toggleMoreMenu() {
    const m = $('moreMenu');
    m.style.display = m.style.display === 'block' ? 'none' : 'block';
  },

  initTheme() {
    const saved = localStorage.getItem('libreta_theme') || 'light';
    document.documentElement.dataset.theme = saved;
    $('themeToggleBtn').textContent = saved === 'dark' ? '☀️' : '🌙';
  },

  toggleTheme() {
    const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('libreta_theme', next);
    $('themeToggleBtn').textContent = next === 'dark' ? '☀️' : '🌙';
    if ($('app').style.display !== 'none') App.render();
  }
};

App.init();
