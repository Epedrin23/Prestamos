/* ═══════════════════════════════════════════════════════
   LIBRETA — Capa de datos
   Funciona en modo LOCAL (localStorage) hasta que pegues tus
   credenciales de Supabase aquí abajo. En cuanto las pegues,
   pasa solo a usar Supabase automáticamente. No necesitas
   tocar nada más en este archivo.
═══════════════════════════════════════════════════════ */

const CONFIG = {
  // Pega aquí la "Project URL" de Supabase (Settings → API)
  SUPABASE_URL: 'https://qdrelqfivduqmjorfcwm.supabase.co',
  // Pega aquí la clave pública — puede llamarse "anon key" o "publishable key"
  // según cuándo creaste el proyecto. NUNCA pegues la "service_role" / "secret".
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkcmVscWZpdmR1cW1qb3JmY3dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNzYwNzMsImV4cCI6MjA5ODk1MjA3M30.6SR485wkFVeiSmOYMAjOF3AgOWhzXpNSBPULDqN0u3c',
  // Dominio "de mentira" para armar los emails de login — no necesita existir,
  // solo identifica a cada usuario dentro de Supabase Auth.
  EMAIL_DOMAIN: 'tulibreta.app'
};

const USERS = {
  spedy: { name: 'Epedrin Flores', email: `spedy@${CONFIG.EMAIL_DOMAIN}` },
  criss: { name: 'Cristian Cerrud', email: `criss@${CONFIG.EMAIL_DOMAIN}` }
};

const REMOTE_MODE = CONFIG.SUPABASE_URL !== 'TU_SUPABASE_URL_AQUI' &&
                    CONFIG.SUPABASE_KEY !== 'TU_SUPABASE_ANON_KEY_AQUI' &&
                    CONFIG.SUPABASE_URL.startsWith('http');
// genId() y nowIso() vienen de logic.js (se carga antes que este archivo)

/* ───────────────────────────────────────────
   Backend LOCAL (localStorage) — modo demo
   Mismo shape de datos que el backend remoto.
─────────────────────────────────────────── */
const LocalBackend = {
  KEY: 'libreta_data_v1',
  SESSION_KEY: 'libreta_local_session',

  _read() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '{}'); }
    catch { return {}; }
  },
  _write(data) { localStorage.setItem(this.KEY, JSON.stringify(data)); },

  async fetchAll() {
    const d = this._read();
    return {
      clients: d.clients || [],
      loans: d.loans || [],
      payments: d.payments || []
    };
  },

  async insert(table, row) {
    const d = this._read();
    d[table] = d[table] || [];
    const full = { id: genId(), createdAt: nowIso(), ...row };
    d[table].push(full);
    this._write(d);
    return full;
  },

  async update(table, id, patch) {
    const d = this._read();
    d[table] = d[table] || [];
    const i = d[table].findIndex(r => r.id === id);
    if (i < 0) throw new Error('No encontrado');
    d[table][i] = { ...d[table][i], ...patch };
    this._write(d);
    return d[table][i];
  },

  async remove(table, id) {
    const d = this._read();
    d[table] = (d[table] || []).filter(r => r.id !== id);
    this._write(d);
  },

  async replaceAll(data) { this._write(data); },

  async upsertMany(table, rows) {
    const d = this._read();
    d[table] = d[table] || [];
    for (const row of rows) {
      const i = d[table].findIndex(r => r.id === row.id);
      if (i >= 0) d[table][i] = { ...d[table][i], ...row };
      else d[table].push(row);
    }
    this._write(d);
  },

  auth: {
    async login(username, password) {
      const u = USERS[username];
      if (!u || password !== 'admin') return { ok: false, error: 'Credenciales incorrectas' };
      localStorage.setItem(LocalBackend.SESSION_KEY, JSON.stringify({ username, name: u.name }));
      return { ok: true, username, name: u.name };
    },
    async logout() { localStorage.removeItem(LocalBackend.SESSION_KEY); },
    async getSession() {
      try { return JSON.parse(localStorage.getItem(LocalBackend.SESSION_KEY) || 'null'); }
      catch { return null; }
    }
  }
};

/* ───────────────────────────────────────────
   Backend REMOTO (Supabase)
─────────────────────────────────────────── */
const RemoteBackend = {
  client: null,
  init() {
    this.client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
    return this.client;
  },

  // snake_case (BD) <-> camelCase (JS)
  _toJs: {
    clients: r => ({ id: r.id, name: r.name, phone: r.phone, note: r.note, createdBy: r.created_by, createdAt: r.created_at }),
    loans: r => ({
      id: r.id, clientId: r.client_id, amount: +r.amount, rate: +r.rate, freq: r.freq,
      dateMode: r.date_mode, startDate: r.start_date, schedule: r.schedule || [],
      note: r.note, isClosed: r.is_closed, closedAt: r.closed_at, closedReason: r.closed_reason,
      renewedFrom: r.renewed_from, createdBy: r.created_by, createdAt: r.created_at
    }),
    payments: r => ({
      id: r.id, loanId: r.loan_id, type: r.type, amount: +r.amount, date: r.date,
      dueDate: r.due_date, createdBy: r.created_by, createdAt: r.created_at
    })
  },
  _toDb: {
    clients: r => ({ name: r.name, phone: r.phone, note: r.note, created_by: r.createdBy }),
    loans: r => ({
      client_id: r.clientId, amount: r.amount, rate: r.rate, freq: r.freq,
      date_mode: r.dateMode, start_date: r.startDate, schedule: r.schedule,
      note: r.note, is_closed: r.isClosed, closed_at: r.closedAt, closed_reason: r.closedReason,
      renewed_from: r.renewedFrom, created_by: r.createdBy
    }),
    payments: r => ({
      loan_id: r.loanId, type: r.type, amount: r.amount, date: r.date,
      due_date: r.dueDate, created_by: r.createdBy
    })
  },

  async fetchAll() {
    const [c, l, p] = await Promise.all([
      this.client.from('clients').select('*').order('created_at'),
      this.client.from('loans').select('*').order('created_at'),
      this.client.from('payments').select('*').order('date')
    ]);
    if (c.error) throw c.error; if (l.error) throw l.error; if (p.error) throw p.error;
    return {
      clients: c.data.map(this._toJs.clients),
      loans: l.data.map(this._toJs.loans),
      payments: p.data.map(this._toJs.payments)
    };
  },

  async insert(table, row) {
    const dbRow = this._toDb[table](row);
    Object.keys(dbRow).forEach(k => dbRow[k] === undefined && delete dbRow[k]);
    const { data, error } = await this.client.from(table).insert(dbRow).select().single();
    if (error) throw error;
    return this._toJs[table](data);
  },

  async update(table, id, patch) {
    // Solo mandamos las llaves que realmente vinieron en "patch"
    const clean = {};
    for (const jsKey of Object.keys(patch)) {
      const oneKeyDb = this._toDb[table]({ [jsKey]: patch[jsKey] });
      Object.assign(clean, Object.fromEntries(Object.entries(oneKeyDb).filter(([, v]) => v !== undefined)));
    }
    const { data, error } = await this.client.from(table).update(clean).eq('id', id).select().single();
    if (error) throw error;
    return this._toJs[table](data);
  },

  async remove(table, id) {
    const { error } = await this.client.from(table).delete().eq('id', id);
    if (error) throw error;
  },

  async upsertMany(table, rows) {
    if (!rows.length) return;
    const dbRows = rows.map(r => ({ id: r.id, created_at: r.createdAt, ...this._toDb[table](r) }));
    const { error } = await this.client.from(table).upsert(dbRows);
    if (error) throw error;
  },

  auth: {
    async login(username, password) {
      const u = USERS[username];
      if (!u) return { ok: false, error: 'Usuario no reconocido' };
      const { data, error } = await RemoteBackend.client.auth.signInWithPassword({ email: u.email, password });
      if (error) return { ok: false, error: 'Credenciales incorrectas' };
      return { ok: true, username, name: u.name, session: data.session };
    },
    async logout() { await RemoteBackend.client.auth.signOut(); },
    async getSession() {
      const { data } = await RemoteBackend.client.auth.getSession();
      if (!data.session) return null;
      const email = data.session.user.email;
      const entry = Object.entries(USERS).find(([, v]) => v.email === email);
      if (!entry) return null;
      return { username: entry[0], name: entry[1].name };
    }
  }
};

/* ───────────────────────────────────────────
   DB — interfaz única que usa main.js
─────────────────────────────────────────── */
const Backend = REMOTE_MODE ? RemoteBackend : LocalBackend;
if (REMOTE_MODE) RemoteBackend.init();

const DB = {
  mode: REMOTE_MODE ? 'remote' : 'local',
  cache: { clients: [], loans: [], payments: [] },
  currentUser: null, // { username, name }

  async refresh() {
    this.cache = await Backend.fetchAll();
    return this.cache;
  },

  getClient(id) { return this.cache.clients.find(c => c.id === id); },
  getLoan(id) { return this.cache.loans.find(l => l.id === id); },
  paymentsOf(loanId) { return this.cache.payments.filter(p => p.loanId === loanId).sort((a, b) => a.date < b.date ? -1 : 1); },
  loansOf(clientId) { return this.cache.loans.filter(l => l.clientId === clientId); },

  clients: {
    async add(row) {
      const full = await Backend.insert('clients', { ...row, createdBy: DB.currentUser?.name });
      DB.cache.clients.push(full);
      return full;
    },
    async update(id, patch) {
      const full = await Backend.update('clients', id, patch);
      const i = DB.cache.clients.findIndex(c => c.id === id);
      if (i >= 0) DB.cache.clients[i] = full;
      return full;
    },
    async remove(id) {
      // Borramos explícitamente pagos → préstamos → cliente, en ese orden,
      // para que funcione igual en modo local y en modo remoto.
      const loans = DB.cache.loans.filter(l => l.clientId === id);
      for (const loan of loans) {
        const pays = DB.cache.payments.filter(p => p.loanId === loan.id);
        for (const pay of pays) await Backend.remove('payments', pay.id);
        await Backend.remove('loans', loan.id);
      }
      await Backend.remove('clients', id);
      DB.cache.payments = DB.cache.payments.filter(p => !loans.some(l => l.id === p.loanId));
      DB.cache.loans = DB.cache.loans.filter(l => l.clientId !== id);
      DB.cache.clients = DB.cache.clients.filter(c => c.id !== id);
    }
  },

  loans: {
    async add(row) {
      const full = await Backend.insert('loans', { ...row, createdBy: DB.currentUser?.name });
      DB.cache.loans.push(full);
      return full;
    },
    async update(id, patch) {
      const full = await Backend.update('loans', id, patch);
      const i = DB.cache.loans.findIndex(l => l.id === id);
      if (i >= 0) DB.cache.loans[i] = full;
      return full;
    },
    async remove(id) {
      const pays = DB.cache.payments.filter(p => p.loanId === id);
      for (const pay of pays) await Backend.remove('payments', pay.id);
      await Backend.remove('loans', id);
      DB.cache.payments = DB.cache.payments.filter(p => p.loanId !== id);
      DB.cache.loans = DB.cache.loans.filter(l => l.id !== id);
    }
  },

  payments: {
    async add(row) {
      const full = await Backend.insert('payments', { ...row, createdBy: DB.currentUser?.name });
      DB.cache.payments.push(full);
      return full;
    },
    async update(id, patch) {
      const full = await Backend.update('payments', id, patch);
      const i = DB.cache.payments.findIndex(p => p.id === id);
      if (i >= 0) DB.cache.payments[i] = full;
      return full;
    },
    async remove(id) {
      await Backend.remove('payments', id);
      DB.cache.payments = DB.cache.payments.filter(p => p.id !== id);
    }
  },

  auth: {
    async login(username, password) {
      const res = await Backend.auth.login(username.trim().toLowerCase(), password);
      if (res.ok) DB.currentUser = { username: res.username, name: res.name };
      return res;
    },
    async logout() { await Backend.auth.logout(); DB.currentUser = null; },
    async restoreSession() {
      const s = await Backend.auth.getSession();
      if (s) DB.currentUser = s;
      return s;
    }
  },

  // Respaldo manual — sirve en modo local Y remoto
  exportBackup() {
    return JSON.stringify({ exportedAt: nowIso(), ...this.cache }, null, 2);
  },
  async importBackup(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    // Orden importante: clientes antes de préstamos, préstamos antes de pagos
    // (por las referencias clientId / loanId). upsert = si el id ya existe se
    // actualiza, si no existía se crea — así nunca se borra nada por error.
    await Backend.upsertMany('clients', data.clients || []);
    await Backend.upsertMany('loans', data.loans || []);
    await Backend.upsertMany('payments', data.payments || []);
    await DB.refresh();
  }
};