/* ═══════════════════════════════════════════════════════
   LIBRETA — Lógica de negocio (funciones puras, sin DOM)
   Verificado con scratch_logic.js antes de usarse aquí.
═══════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const money = n => '$' + (+(n || 0)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const today = () => new Date().toISOString().split('T')[0];
const nowIso = () => new Date().toISOString();
const genId = () => 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtDate = iso => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const M = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${+d} ${M[+m - 1]} ${y}`;
};

const daysDiff = iso => {
  if (!iso) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const tgt = new Date(iso + 'T00:00:00');
  return Math.round((tgt - now) / 86400000);
};

function buildSchedule(startIso, freq, dateMode, count) {
  count = count || 24;
  const dates = [];
  const d = new Date(startIso + 'T00:00:00');
  if (dateMode === 'panama') {
    const day = d.getDate();
    if (day < 15) d.setDate(15);
    else if (day < 30) d.setDate(30);
    else { d.setMonth(d.getMonth() + 1); d.setDate(15); }
  }
  for (let i = 0; i < count; i++) {
    dates.push(d.toISOString().split('T')[0]);
    if (dateMode === 'panama') {
      if (d.getDate() === 15) d.setDate(30);
      else { d.setMonth(d.getMonth() + 1); d.setDate(15); }
    } else {
      if (freq === 'quincenal') d.setDate(d.getDate() + 15);
      else d.setMonth(d.getMonth() + 1);
    }
  }
  return dates;
}

// Extiende (sin persistir) el calendario hasta que tenga al menos
// `neededIndex + 1` fechas. Siempre se puede recalcular gratis, así
// que nunca hace falta guardar la extensión en la base de datos.
function scheduleUpTo(loan, neededIndex) {
  let schedule = loan.schedule || [];
  while (schedule.length <= neededIndex) {
    const last = schedule[schedule.length - 1] || loan.startDate;
    const extra = buildSchedule(last, loan.freq, loan.dateMode, 12);
    schedule = schedule.concat(schedule.length ? extra.slice(1) : extra);
  }
  return schedule;
}

function interestPaymentsOf(loanId, payments) {
  return payments.filter(p => p.loanId === loanId && p.type === 'interest')
                  .sort((a, b) => a.date < b.date ? -1 : 1);
}

function capitalPaidOf(loanId, payments) {
  return payments.filter(p => p.loanId === loanId && p.type === 'capital')
                  .reduce((s, p) => s + p.amount, 0);
}

// Capital pendiente = monto original - abonos a capital ya registrados.
function loanOutstanding(loan, payments) {
  return Math.max(0, +(loan.amount - capitalPaidOf(loan.id, payments)).toFixed(2));
}

// La cuota de interés se recalcula siempre sobre el capital pendiente,
// así que un abono parcial reduce la cuota de ahí en adelante.
function loanCuota(loan, payments) {
  return +(loanOutstanding(loan, payments) * loan.rate / 100).toFixed(2);
}

function nextDueDate(loan, payments) {
  if (loan.isClosed) return null;
  const paidCount = interestPaymentsOf(loan.id, payments).length;
  const schedule = scheduleUpTo(loan, paidCount);
  return schedule[paidCount] || null;
}

function loanStatus(loan, payments) {
  if (loan.isClosed) return 'done';
  const due = nextDueDate(loan, payments);
  if (!due) return 'done';
  const diff = daysDiff(due);
  if (diff < 0) return 'overdue';
  if (diff <= 3) return 'warning';
  return 'ok';
}
