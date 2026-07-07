/* ═══════════════════════════════════════════════════════
   LIBRETA — Reportes (PDF y Excel)
═══════════════════════════════════════════════════════ */

const Reports = {
  _footer(doc) {
    const W = doc.internal.pageSize.getWidth();
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(7); doc.setTextColor(180, 180, 180);
      doc.text(`Libreta · Pág ${i}/${pages}`, W / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' });
    }
  },

  loanPDF(loanId) {
    const loan = DB.getLoan(loanId);
    if (!loan) return UI.toast('Préstamo no encontrado', 'rust');
    const client = DB.getClient(loan.clientId);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const W = doc.internal.pageSize.getWidth();
    const payments = DB.paymentsOf(loanId);
    const cuota = loanCuota(loan, DB.cache.payments);
    const outstanding = loanOutstanding(loan, DB.cache.payments);
    const interestPaid = payments.filter(p => p.type === 'interest').reduce((s, p) => s + p.amount, 0);
    const capitalPaid = payments.filter(p => p.type === 'capital').reduce((s, p) => s + p.amount, 0);
    const pm = loan.freq === 'quincenal' ? cuota * 2 : cuota;

    doc.setFillColor(27, 42, 60); doc.rect(0, 0, W, 32, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.text('LIBRETA', 14, 14);
    doc.setFontSize(8); doc.setFont(undefined, 'normal');
    doc.text('Control de Préstamos · Documento', 14, 23);
    doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, W - 14, 23, { align: 'right' });

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10); doc.setFont(undefined, 'bold');
    doc.text('DATOS DEL PRÉSTAMO', 14, 44);

    const rows1 = [
      ['Cliente', client?.name || '—'], ['Teléfono', client?.phone || '—'],
      ['Capital Original', money(loan.amount)], ['Tasa', loan.rate + '%'], ['Frecuencia', loan.freq]
    ];
    const rows2 = [
      ['Cuota Actual', money(cuota)], ['Interés Mensual', money(pm)],
      ['Interés Total Cobrado', money(interestPaid)], ['Capital Abonado', money(capitalPaid)],
      ['Capital Pendiente', loan.isClosed ? 'SALDADO' : money(outstanding)]
    ];
    doc.setFontSize(8.5);
    rows1.forEach(([k, v], i) => {
      doc.setFont(undefined, 'normal'); doc.setTextColor(130, 130, 130); doc.text(k + ':', 14, 52 + i * 7.5);
      doc.setFont(undefined, 'bold'); doc.setTextColor(20, 20, 20); doc.text(String(v), 55, 52 + i * 7.5);
    });
    rows2.forEach(([k, v], i) => {
      doc.setFont(undefined, 'normal'); doc.setTextColor(130, 130, 130); doc.text(k + ':', 110, 52 + i * 7.5);
      doc.setFont(undefined, 'bold'); doc.setTextColor(20, 20, 20); doc.text(String(v), 160, 52 + i * 7.5);
    });

    doc.setFillColor(245, 244, 240);
    doc.roundedRect(14, 96, W - 28, 15, 2, 2, 'F');
    doc.setFontSize(9.5); doc.setFont(undefined, 'bold'); doc.setTextColor(31, 111, 80);
    doc.text(`Total interés cobrado: ${money(interestPaid)}`, 18, 105);
    doc.setTextColor(100, 100, 100); doc.setFontSize(7.5); doc.setFont(undefined, 'normal');
    doc.text(loan.isClosed ? `Cerrado el ${fmtDate(loan.closedAt)}` : `Capital pendiente: ${money(outstanding)}`, W - 16, 105, { align: 'right' });

    doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(0, 0, 0);
    doc.text('HISTORIAL DE PAGOS', 14, 120);

    const tRows = payments.map(p => [fmtDate(p.date), p.type === 'interest' ? 'Interés' : 'Capital', money(p.amount)]);
    doc.autoTable({
      startY: 125,
      head: [['Fecha', 'Tipo', 'Monto']],
      body: tRows.length ? tRows : [['—', '—', 'Sin pagos']],
      theme: 'striped',
      headStyles: { fillColor: [27, 42, 60], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, cellPadding: 3 },
      alternateRowStyles: { fillColor: [246, 245, 241] },
      columnStyles: { 2: { halign: 'right', fontStyle: 'bold' } }
    });

    this._footer(doc);
    doc.save(`Libreta_${(client?.name || 'cliente').replace(/\s+/g, '_')}_${today()}.pdf`);
  },

  portfolioPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const W = doc.internal.pageSize.getWidth();
    const active = DB.cache.loans.filter(l => !l.isClosed);
    const totalCapital = active.reduce((s, l) => s + loanOutstanding(l, DB.cache.payments), 0);
    const totalInterest = active.reduce((s, l) => {
      const c = loanCuota(l, DB.cache.payments);
      return s + (l.freq === 'quincenal' ? c * 2 : c);
    }, 0);

    doc.setFillColor(27, 42, 60); doc.rect(0, 0, W, 32, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.text('LIBRETA', 14, 14);
    doc.setFontSize(8); doc.setFont(undefined, 'normal');
    doc.text('Reporte General de Cartera', 14, 23);
    doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, W - 14, 23, { align: 'right' });

    doc.setTextColor(130, 130, 130); doc.setFontSize(8); doc.setFont(undefined, 'normal');
    doc.text('Clientes', 14, 42); doc.text('Préstamos activos', 65, 42);
    doc.text('Capital en calle', 122, 42); doc.text('Interés mensual', 172, 42);
    doc.setFont(undefined, 'bold'); doc.setTextColor(20, 20, 20); doc.setFontSize(11);
    doc.text(String(DB.cache.clients.length), 14, 49);
    doc.text(String(active.length), 65, 49);
    doc.text(money(totalCapital), 122, 49);
    doc.text(money(totalInterest), 172, 49);

    const rows = active.map(l => {
      const client = DB.getClient(l.clientId);
      const due = nextDueDate(l, DB.cache.payments);
      const status = loanStatus(l, DB.cache.payments);
      const lbl = status === 'overdue' ? 'Vencido' : status === 'warning' ? 'Próximo' : 'Al día';
      return [client?.name || '—', money(l.amount), l.rate + '%', due ? fmtDate(due) : '—', lbl, money(loanOutstanding(l, DB.cache.payments))];
    });

    doc.autoTable({
      startY: 58,
      head: [['Cliente', 'Monto', 'Tasa', 'Próx. Pago', 'Estado', 'Pendiente']],
      body: rows.length ? rows : [['—', '—', '—', '—', 'Sin préstamos activos', '—']],
      theme: 'striped',
      headStyles: { fillColor: [27, 42, 60], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, cellPadding: 3 },
      alternateRowStyles: { fillColor: [246, 245, 241] },
      columnStyles: { 1: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } }
    });

    this._footer(doc);
    doc.save(`Libreta_Reporte_General_${today()}.pdf`);
  },

  moraPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const W = doc.internal.pageSize.getWidth();
    const overdue = DB.cache.loans.filter(l => !l.isClosed && loanStatus(l, DB.cache.payments) === 'overdue')
      .map(l => ({ loan: l, client: DB.getClient(l.clientId), due: nextDueDate(l, DB.cache.payments) }))
      .filter(x => x.client)
      .sort((a, b) => daysDiff(a.due) - daysDiff(b.due));
    const totalRisk = overdue.reduce((s, x) => s + loanOutstanding(x.loan, DB.cache.payments), 0);

    doc.setFillColor(156, 63, 39); doc.rect(0, 0, W, 32, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.text('LIBRETA', 14, 14);
    doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.text('Reporte de Morosidad', 14, 23);
    doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, W - 14, 23, { align: 'right' });

    doc.setTextColor(0, 0, 0); doc.setFontSize(9);
    doc.text(`${overdue.length} préstamo(s) vencido(s)  ·  Capital en riesgo: ${money(totalRisk)}`, 14, 42);

    const rows = overdue.map(({ loan, client, due }) => {
      const diff = daysDiff(due);
      return [client.name, client.phone || '—', money(loanCuota(loan, DB.cache.payments)), fmtDate(due), `${Math.abs(diff)} día(s)`, money(loanOutstanding(loan, DB.cache.payments))];
    });
    doc.autoTable({
      startY: 50,
      head: [['Cliente', 'Teléfono', 'Cuota', 'Venció', 'Retraso', 'Capital pendiente']],
      body: rows.length ? rows : [['—', '—', '—', '—', '—', 'Sin préstamos vencidos']],
      theme: 'striped',
      headStyles: { fillColor: [156, 63, 39], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, cellPadding: 3 },
      alternateRowStyles: { fillColor: [246, 245, 241] },
      columnStyles: { 5: { halign: 'right', fontStyle: 'bold' } }
    });

    this._footer(doc);
    doc.save(`Libreta_Morosidad_${today()}.pdf`);
  },

  portfolioExcel() {
    const clientsSheet = DB.cache.clients.map(c => ({
      Nombre: c.name, Teléfono: c.phone, Nota: c.note,
      'Creado por': c.createdBy, 'Creado el': (c.createdAt || '').slice(0, 10)
    }));
    const loansSheet = DB.cache.loans.map(l => {
      const client = DB.getClient(l.clientId);
      const status = loanStatus(l, DB.cache.payments);
      const due = l.isClosed ? '' : (nextDueDate(l, DB.cache.payments) || '');
      return {
        Cliente: client?.name || '—',
        'Monto Original': l.amount, 'Tasa %': l.rate, Frecuencia: l.freq, 'Modo Fechas': l.dateMode,
        'Capital Pendiente': loanOutstanding(l, DB.cache.payments),
        'Cuota Actual': loanCuota(l, DB.cache.payments),
        Estado: l.isClosed ? 'Saldado' : (status === 'overdue' ? 'Vencido' : status === 'warning' ? 'Próximo' : 'Al día'),
        'Próx. Pago': due,
        Nota: l.note, 'Creado por': l.createdBy, 'Creado el': (l.createdAt || '').slice(0, 10)
      };
    });
    const paymentsSheet = DB.cache.payments.map(p => {
      const loan = DB.getLoan(p.loanId);
      const client = loan ? DB.getClient(loan.clientId) : null;
      return {
        Cliente: client?.name || '—', Tipo: p.type === 'interest' ? 'Interés' : 'Capital',
        Monto: p.amount, Fecha: p.date, Vence: p.dueDate || '', 'Registrado por': p.createdBy
      };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clientsSheet), 'Clientes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(loansSheet), 'Préstamos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentsSheet), 'Pagos');
    XLSX.writeFile(wb, `Libreta_Reporte_${today()}.xlsx`);
  }
};
