(function () {
  var C = window.Core;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var brl = C.brl;

  var items = {};
  var tab = 'resumo';
  var ym = C.todayStr().slice(0, 7);
  var sync = 'info';
  var showQuitadas = false;
  var form = null; // estado do formulário aberto
  var detail = null; // id da compra parcelada aberta
  var imp = null; // importação de extrato em revisão
  var chartN = 6, chartCat = ''; // gráfico mês a mês

  function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function today() { return C.todayStr(); }

  /* ---------- confirmação dentro do app (confirm() nativo não funciona em todo lugar) ---------- */
  var dlgCb = null;
  function ask(msg, okLabel, cb) {
    dlgCb = cb;
    var d = $('#dlg');
    d.innerHTML = '<div class="db"><p>' + esc(msg) + '</p><div class="btns"><button class="btn sec" data-act="dlgno">Cancelar</button><button class="btn danger2" data-act="dlgyes">' + esc(okLabel) + '</button></div></div>';
    d.className = 'dlg open';
  }
  function closeDlg() { $('#dlg').className = 'dlg'; }

  /* ---------- toast ---------- */
  var toastT = null;
  function toast(msg, bad) {
    var el = $('#toast');
    el.textContent = msg; el.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(function () { el.className = 'toast'; }, 2600);
  }

  /* ---------- persistência (otimista) ---------- */
  function save(id, obj) {
    items[id] = obj; render();
    return window.Cloud.set(id, obj).catch(function () { toast('Não consegui salvar na nuvem. Verifique a internet.', true); window.Cloud.pull(true); });
  }
  function remove(id) {
    delete items[id]; render();
    return window.Cloud.del(id).catch(function () { toast('Não consegui excluir na nuvem.', true); window.Cloud.pull(true); });
  }

  /* ---------- telas ---------- */
  function monthNav() {
    return '<div class="mnav"><button data-act="prev" aria-label="Mês anterior">‹</button><b>' + C.ymLabel(ym) + '</b><button data-act="next" aria-label="Próximo mês">›</button></div>';
  }

  function viewResumo() {
    var ent = C.entriesForMonth(items, ym), s = C.summarize(ent), orc = C.orcamentos(items);
    var h = monthNav();
    h += '<div class="cards"><div class="card"><small>Receitas</small><b class="pos">' + brl(s.receitas) + '</b></div>' +
      '<div class="card"><small>Despesas</small><b class="neg">' + brl(s.despesas) + '</b></div>' +
      '<div class="card wide"><small>Saldo do mês</small><b class="' + (s.saldo < 0 ? 'neg' : 'pos') + '">' + brl(s.saldo) + '</b></div></div>';

    h += chartHtml();
    var rendaRef = s.receitas;
    h += '<section><h3>Saúde financeira</h3><div class="kpis">' +
      '<div><small>Poupança</small><b>' + (s.poupanca === null ? '—' : C.pct(s.poupanca)) + '</b><i>da renda</i></div>' +
      '<div><small>Parcelas</small><b>' + (rendaRef > 0 ? C.pct(s.parcelas / rendaRef) : '—') + '</b><i>' + brl(s.parcelas) + '</i></div>' +
      '</div></section>';

    h += '<section><h3>Para onde foi o dinheiro</h3>';
    if (!s.cats.length) h += '<p class="muted">Nenhum gasto neste mês.</p>';
    else {
      var max = s.cats[0].valor;
      s.cats.forEach(function (c) {
        var lim = orc[c.cat], ratio = lim ? c.valor / lim : null;
        var w = Math.max(3, Math.round((lim ? Math.min(ratio, 1) : c.valor / max) * 100));
        var cls = ratio === null ? '' : ratio > 1 ? ' over' : ratio >= 0.8 ? ' warn' : '';
        h += '<div class="bar' + cls + '"><div class="bl"><span>' + esc(c.cat) + '</span><b>' + brl(c.valor) + '</b></div>' +
          '<div class="bt"><i style="width:' + w + '%"></i></div>' +
          '<small>' + C.pct(c.valor / s.despesas) + ' dos gastos' + (lim ? ' · limite ' + brl(lim) : '') + '</small></div>';
      });
    }
    h += '</section>';

    var proj = C.projecaoParcelas(items, ym, 6), pm = Math.max.apply(null, proj.map(function (p) { return p.valor; }).concat([1]));
    if (proj.some(function (p) { return p.valor > 0; })) {
      h += '<section><h3>Parcelas nos próximos meses</h3><div class="cols">';
      proj.forEach(function (p) {
        h += '<div class="col"><span class="v">' + (p.valor ? Math.round(p.valor) : '') + '</span><i style="height:' + Math.max(2, Math.round(p.valor / pm * 90)) + 'px"></i><small>' + C.ymShort(p.ym).slice(0, 3) + '</small></div>';
      });
      h += '</div></section>';
    }
    return h;
  }


  /* ---------- gráfico mês a mês ---------- */
  function kfmt(v) { return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',') + 'k' : String(Math.round(v)); }
  function niceMax(m) { var k = Math.pow(10, Math.floor(Math.log(m) / Math.LN10)); return Math.ceil(m / k) * k; }

  function chartHtml() {
    var serie = C.serieMensal(items, ym, chartN, chartCat), cur = today().slice(0, 7);
    var W = 360, H = 176, pl = 4, pr = 4, pt = 16, pb = 24, iw = W - pl - pr, ih = H - pt - pb;
    var vals = [1]; serie.forEach(function (m) { vals.push(m.despesas); if (!chartCat) vals.push(m.receitas); });
    var top = niceMax(Math.max.apply(null, vals)), gw = iw / serie.length, nb = chartCat ? 1 : 2, bw = Math.min(24, (gw - 8) / nb);
    var sv = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Receitas e despesas dos últimos ' + chartN + ' meses">';
    [0, 0.5, 1].forEach(function (f) {
      var y = pt + ih - ih * f;
      sv += '<line class="gl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '"/>';
    });
    sv += '<text class="ax" x="' + pl + '" y="' + (pt - 4) + '">' + kfmt(top) + '</text>';
    serie.forEach(function (m, i) {
      var x0 = pl + gw * i + (gw - bw * nb - (nb > 1 ? 2 : 0)) / 2, fut = m.ym > cur, sel = m.ym === ym;
      var g = '<g data-act="pickym" data-ym="' + m.ym + '" class="mg' + (sel ? ' sel' : '') + (fut ? ' fut' : '') + '"><rect x="' + (pl + gw * i) + '" y="0" width="' + gw + '" height="' + H + '" fill="transparent"/>';
      var bars = chartCat ? [[m.despesas, 'bac']] : [[m.receitas, 'bpos'], [m.despesas, 'bneg']];
      bars.forEach(function (b, k) {
        var h = Math.max(b[0] > 0 ? 2 : 0, ih * b[0] / top), x = x0 + k * (bw + 2), y = pt + ih - h;
        g += '<rect class="b ' + b[1] + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"/>';
        if (b[0] > 0 && (chartN <= 6 || sel)) g += '<text class="vl" x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 3).toFixed(1) + '" text-anchor="middle">' + kfmt(b[0]) + '</text>';
      });
      g += '<text class="ml" x="' + (pl + gw * i + gw / 2).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle">' + C.ymShort(m.ym).slice(0, 3).toLowerCase() + '</text></g>';
      sv += g;
    });
    sv += '</svg>';
    var passados = serie.filter(function (m) { return m.ym <= cur; }).slice(-3);
    var mediaG = passados.length ? passados.reduce(function (a, m) { return a + m.despesas; }, 0) / passados.length : 0;
    var mediaR = passados.length ? passados.reduce(function (a, m) { return a + m.receitas; }, 0) / passados.length : 0;
    var selM = serie[serie.length - 1], prevM = serie[serie.length - 2], delta = '';
    if (prevM && prevM.despesas > 0) { var d = selM.despesas / prevM.despesas - 1; delta = ' · ' + (d >= 0 ? '▲ ' : '▼ ') + C.pct(Math.abs(d)) + ' vs mês anterior'; }
    var h = '<section class="chs"><h3>Evolução mês a mês</h3><div class="chc"><div class="seg small"><button data-act="chartn" data-n="6" aria-pressed="' + (chartN === 6) + '">6 meses</button><button data-act="chartn" data-n="12" aria-pressed="' + (chartN === 12) + '">12 meses</button></div>' +
      '<select id="ch-cat" aria-label="Categoria do gráfico"><option value="">Receitas e despesas</option>' + C.CATS_G.map(function (c) { return '<option' + (c === chartCat ? ' selected' : '') + ' value="' + esc(c) + '">Só ' + esc(c) + '</option>'; }).join('') + '</select></div>' + sv +
      '<p class="legend">' + (chartCat ? '<i class="lg bac"></i>' + esc(chartCat) : '<i class="lg bpos"></i>Receitas <i class="lg bneg"></i>Despesas') + ' · tom claro = previsto (parcelas e fixos). Toque num mês para abri-lo.</p>' +
      '<p class="muted small">' + (passados.length ? 'Média dos últimos ' + passados.length + ' meses: ' + (chartCat ? '' : 'receitas ' + brl(mediaR) + ' · ') + 'gastos ' + brl(mediaG) : '') + (chartCat ? '' : '') + esc(delta) + '</p></section>';
    return h;
  }

  function entryRow(e) {
    var badge = e.tipo === 'parc' ? '<em>parcela</em>' : e.tipo === 'fixo' ? '<em>fixo</em>' : '';
    return '<button class="row" data-act="open" data-src="' + esc(e.src) + '" data-tipo="' + e.tipo + '"><div><b>' + esc(e.desc) + '</b> ' + badge +
      '<small>' + esc(e.cat) + (e.pgto ? ' · ' + esc(e.pgto) : '') + '</small></div><strong class="' + (e.kind === 'receita' ? 'pos' : 'neg') + '">' + (e.kind === 'receita' ? '+' : '-') + brl(e.valor).replace('R$ ', 'R$ ') + '</strong></button>';
  }

  function viewLanc() {
    var ent = C.entriesForMonth(items, ym), h = monthNav() + '<label class="btn sec impbtn">Importar extrato do banco (CSV ou OFX)<input type="file" id="impx" accept=".csv,.ofx,.qfx,.txt,text/csv,text/plain,application/x-ofx" hidden></label>';
    if (!ent.length) return h + '<p class="empty">Nada lançado neste mês.<br>Toque no <b>+</b> para começar ou importe o extrato.</p>';
    var day = null;
    ent.forEach(function (e) {
      if (e.data !== day) { day = e.data; h += '<h4>' + C.fmtDate(day) + (day === today() ? ' · hoje' : '') + '</h4>'; }
      h += entryRow(e);
    });
    return h;
  }

  function parcList() {
    return Object.keys(items).filter(function (id) { return items[id].t === 'parc'; }).map(function (id) {
      return { id: id, p: items[id], st: C.parcStatus(items[id], today()) };
    });
  }

  function parcCard(x) {
    var p = x.p, st = x.st, pctv = Math.round(st.pagas / p.n * 100);
    return '<button class="pc" data-act="parc" data-id="' + x.id + '"><div class="pt"><b>' + esc(p.desc) + '</b><strong>' + brl(st.parcela) + '<small>/mês</small></strong></div>' +
      '<div class="bt"><i style="width:' + pctv + '%"></i></div>' +
      '<div class="pm"><span>' + st.pagas + ' de ' + p.n + ' pagas · ' + (st.faltam ? 'faltam ' + st.faltam : 'quitada') + '</span>' +
      '<span>' + (st.proxima ? 'próx. ' + C.fmtDate(st.proxima.data).slice(0, 5) : '') + '</span></div>' +
      (st.faltam ? '<small>Restante: ' + brl(st.restante) + ' · ' + esc(p.cat) + (p.pgto ? ' · ' + esc(p.pgto) : '') + '</small>' : '') + '</button>';
  }

  function viewParc() {
    var list = parcList(), abertas = list.filter(function (x) { return x.st.faltam > 0; }), quit = list.filter(function (x) { return x.st.faltam === 0; });
    abertas.sort(function (a, b) { return a.st.proxima.data < b.st.proxima.data ? -1 : 1; });
    var restante = abertas.reduce(function (a, x) { return a + x.st.restante; }, 0);
    var proxMes = C.projecaoParcelas(items, today().slice(0, 7), 2);
    var h = '<div class="cards"><div class="card"><small>Total restante</small><b class="neg">' + brl(restante) + '</b></div>' +
      '<div class="card"><small>Este mês</small><b>' + brl(proxMes[0].valor) + '</b></div></div>';
    if (!list.length) return h + '<p class="empty">Nenhuma compra parcelada.<br>Toque no <b>+</b> e marque “Compra parcelada”.</p>';
    h += '<h3 class="sec">Em andamento</h3>';
    if (!abertas.length) h += '<p class="muted">Nenhuma parcela em aberto.</p>';
    abertas.forEach(function (x) { h += parcCard(x); });

    var cal = C.projecaoParcelas(items, today().slice(0, 7), 6).filter(function (m) { return m.valor > 0; });
    if (cal.length) {
      h += '<h3 class="sec">Calendário de vencimentos</h3>';
      cal.forEach(function (m) {
        var ent = C.entriesForMonth(items, m.ym).filter(function (e) { return e.tipo === 'parc'; }).sort(function (a, b) { return a.data < b.data ? -1 : 1; });
        h += '<div class="mon"><div class="mh"><b>' + C.ymLabel(m.ym) + '</b><strong>' + brl(m.valor) + '</strong></div>';
        ent.forEach(function (e) { h += '<div class="ml"><span>dia ' + e.data.slice(8) + '</span><span>' + esc(e.desc) + '</span><b>' + brl(e.valor) + '</b></div>'; });
        h += '</div>';
      });
    }
    if (quit.length) {
      h += '<button class="link" data-act="quit">' + (showQuitadas ? 'Ocultar' : 'Mostrar') + ' quitadas (' + quit.length + ')</button>';
      if (showQuitadas) quit.forEach(function (x) { h += parcCard(x); });
    }
    return h;
  }

  function viewDicas() {
    var tips = C.insights(items, ym, today()), h = monthNav();
    tips.forEach(function (t) { h += '<div class="tip ' + t.tone + '"><b>' + esc(t.title) + '</b><p>' + esc(t.text) + '</p></div>'; });
    h += '<p class="muted small">As dicas são calculadas só com os seus lançamentos. Não substituem um planejador financeiro.</p>';
    return h;
  }

  function viewMais() {
    var orc = C.orcamentos(items);
    var h = '<section><h3>Orçamento mensal por categoria</h3><p class="muted small">Defina um limite e o app avisa no Resumo e nas Dicas quando você chegar perto. Deixe vazio para sem limite.</p><div class="orc">';
    C.CATS_G.forEach(function (c) {
      h += '<label><span>' + c + '</span><input inputmode="decimal" data-orc="' + c + '" placeholder="sem limite" value="' + (orc[c] ? String(orc[c]).replace('.', ',') : '') + '"></label>';
    });
    h += '</div><button class="btn" data-act="saveorc">Salvar orçamento</button></section>';
    h += '<section><h3>Seu nome no banco</h3><p class="muted small">Usado na importação de extrato para ignorar Pix e transferências entre as suas próprias contas. Digite como aparece no extrato.</p>' +
      '<label class="mel"><input id="me-nome" placeholder="Ex.: MARIA DA SILVA" autocomplete="off" value="' + esc((items.cfg_me && items.cfg_me.nome) || '') + '"></label><button class="btn sec" data-act="saveme">Salvar nome</button></section>';
    if (window.Cloud.isLocal()) h += '<section><h3>Modo teste</h3><p class="muted small">Os dados de exemplo ficam misturados com o que você importar. Apague tudo para começar do zero e importar só o seu extrato.</p><button class="btn danger" data-act="clearlocal">Apagar dados de exemplo e começar do zero</button></section>';
    h += '<section><h3>Backup</h3><p class="muted small">Exporta tudo em um arquivo JSON legível (sem criptografia). Guarde em local seguro.</p>' +
      '<div class="btns"><button class="btn sec" data-act="export">Exportar</button><label class="btn sec">Importar<input type="file" id="imp" accept="application/json" hidden></label></div></section>';
    h += '<section><h3>Segurança</h3><p class="muted small">Seus dados são criptografados neste aparelho antes de ir para a nuvem, usando a senha do app. Quem não tem a senha não consegue ler. A senha é pedida toda vez que o app abre, e ele bloqueia sozinho após 5 minutos parado ou 2 minutos em segundo plano. <b>Se esquecer a senha, não há como recuperar os dados.</b> Faça backups de vez em quando.</p>' +
      '<button class="btn sec" data-act="lock">Sair e bloquear agora</button></section>';
    return h;
  }

  var TITLES = { resumo: 'Resumo', lanc: 'Lançamentos', parc: 'Parcelas', dicas: 'Dicas', mais: 'Mais' };

  function render() {
    if (!$('#app').dataset.on) return;
    var v = tab === 'resumo' ? viewResumo() : tab === 'lanc' ? viewLanc() : tab === 'parc' ? viewParc() : tab === 'dicas' ? viewDicas() : viewMais();
    $('#title').textContent = TITLES[tab];
    $('#main').innerHTML = v;
    document.querySelectorAll('#tabs button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.tab === tab ? 'true' : 'false'); });
    var s = $('#sync'); s.dataset.s = sync; s.title = sync === 'ok' ? 'Sincronizado' : sync === 'off' ? 'Sem conexão' : 'Conectando';
    renderSheet();
  }

  /* ---------- formulário ---------- */
  function newForm(kind) {
    return { id: null, tipo: 'tx', kind: kind || 'gasto', valor: '', desc: '', cat: '', data: today(), pgto: C.pgtoMaisUsado(items) || 'Cartão de crédito',
      parcelado: false, n: 2, modo: 'total', primeira: today(), primeiraTouched: false, fixo: false, fim: '', catTouched: false, pgtoTouched: false, sugs: [] };
  }

  /* Cartão de crédito costuma cair na fatura do mês seguinte; outras formas, no mesmo dia. */
  function defPrimeira(f) { return f.pgto === 'Cartão de crédito' ? C.addMonths(f.data, 1) : f.data; }
  function setPrimeira(f) {
    f.primeira = defPrimeira(f);
    var el = document.getElementById('f-prim'); if (el) el.value = f.primeira;
  }

  function openDetail(id) { form = null; detail = id; renderSheet(); }

  function openEdit(src, tipo) {
    var it = items[src]; if (!it) return;
    if (tipo === 'parc') return openDetail(src);
    var f = newForm(it.kind); f.id = src; f.tipo = it.t; f.desc = it.desc; f.cat = it.cat; f.pgto = it.pgto || ''; f.catTouched = true; f.pgtoTouched = true;
    f.valor = String(it.valor).replace('.', ',');
    if (it.t === 'tx') f.data = it.data;
    else { f.fixo = true; f.data = it.inicio + '-' + C.pad(it.dia || 1); f.fim = it.fim || ''; }
    form = f; renderSheet();
  }

  function editParc(id) {
    var it = items[id]; if (!it) return;
    var f = newForm('gasto'); f.id = id; f.tipo = 'parc'; f.parcelado = true; f.desc = it.desc; f.cat = it.cat; f.pgto = it.pgto || ''; f.catTouched = true; f.pgtoTouched = true;
    f.valor = String(it.total).replace('.', ','); f.n = it.n; f.data = it.compra || it.primeira; f.primeira = it.primeira; f.primeiraTouched = true;
    detail = null; form = f; renderSheet();
  }

  function preview(f) {
    var v = C.parseMoneyExpr(f.valor), n = parseInt(f.n, 10);
    if (!(v > 0) || !(n >= 2) || !f.primeira) return '';
    var total = f.modo === 'parcela' ? Math.round(v * n * 100) / 100 : v;
    var l = C.parcelas({ total: total, n: n, primeira: f.primeira });
    return n + 'x de ' + brl(l[0].valor) + ' · total ' + brl(total) + ' · última em ' + C.fmtDate(l[l.length - 1].data);
  }

  function opts(list, sel) {
    return list.map(function (c) { return '<option' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  }

  function formHtml(f) {
    var cats = f.kind === 'receita' ? C.CATS_R : C.CATS_G, cat = cats.indexOf(f.cat) >= 0 ? f.cat : cats[0];
    var h = '<div class="sh-h"><b>' + (f.id ? 'Editar' : 'Novo lançamento') + '</b><button data-act="close" aria-label="Fechar">✕</button></div>';
    if (!f.id) h += '<div class="seg"><button data-act="kind" data-k="gasto" aria-pressed="' + (f.kind === 'gasto') + '">Gasto</button><button data-act="kind" data-k="receita" aria-pressed="' + (f.kind === 'receita') + '">Receita</button></div>';
    var parcOn = f.parcelado && f.kind === 'gasto';
    h += '<label>' + (parcOn ? (f.modo === 'parcela' ? 'Valor de cada parcela' : 'Valor total da compra') : 'Valor') + '<input id="f-valor" inputmode="decimal" placeholder="0,00" value="' + esc(f.valor) + '" autocomplete="off"></label><p class="calc" id="f-calc"></p>';
    h += '<label>Descrição<input id="f-desc" placeholder="Ex.: Notebook, Mercado, Salário" value="' + esc(f.desc) + '" autocomplete="off"></label>' +
      '<div class="chips" id="f-chips"></div><p class="hintline" id="f-hint"></p>';
    h += '<label>Categoria<select id="f-cat">' + opts(cats, cat) + '</select></label>';
    h += '<label>' + (parcOn ? 'Data da compra' : f.fixo ? 'Dia/mês de início' : 'Data') + '<input id="f-data" type="date" value="' + f.data + '"></label>';
    if (!f.id) h += '<div class="chips"><button type="button" class="chip mini" data-act="dia" data-d="0">Hoje</button><button type="button" class="chip mini" data-act="dia" data-d="-1">Ontem</button><button type="button" class="chip mini" data-act="dia" data-d="-2">Anteontem</button></div>';
    if (f.kind === 'gasto') h += '<label>Forma de pagamento<select id="f-pgto">' + opts(C.PGTOS, f.pgto) + '</select></label>';
    if (f.kind === 'gasto' && (!f.id || f.tipo === 'parc')) {
      h += '<label class="chk"><input type="checkbox" id="f-parc"' + (parcOn ? ' checked' : '') + (f.id ? ' disabled' : '') + '> Compra parcelada</label>';
      if (parcOn) {
        h += '<div class="grp"><label>Nº de parcelas<input id="f-n" type="number" min="2" max="72" value="' + esc(f.n) + '"></label>' +
          '<div class="seg small"><button data-act="modo" data-m="total" aria-pressed="' + (f.modo === 'total') + '">Informei o total</button><button data-act="modo" data-m="parcela" aria-pressed="' + (f.modo === 'parcela') + '">Informei a parcela</button></div>' +
          '<label>Vencimento da 1ª parcela<input id="f-prim" type="date" value="' + f.primeira + '"></label>' +
          '<p class="prev" id="f-prev">' + esc(preview(f)) + '</p></div>';
      }
    }
    if (!parcOn && (!f.id || f.tipo === 'fixo')) {
      h += '<label class="chk"><input type="checkbox" id="f-fixo"' + (f.fixo ? ' checked' : '') + (f.id ? ' disabled' : '') + '> Repete todo mês (fixo)</label>';
      if (f.fixo) h += '<label>Encerrar em (opcional)<input id="f-fim" type="month" value="' + esc(f.fim) + '"></label>';
    }
    h += '<div class="btns">' + (f.id ? '<button class="btn danger" data-act="del">Excluir</button>' : '') + '<button class="btn" data-act="submit">Salvar</button></div>';
    return h;
  }

  function detailHtml(id) {
    var p = items[id]; if (!p) return '';
    var st = C.parcStatus(p, today());
    var h = '<div class="sh-h"><b>' + esc(p.desc) + '</b><button data-act="close" aria-label="Fechar">✕</button></div>' +
      '<p class="muted">' + esc(p.cat) + (p.pgto ? ' · ' + esc(p.pgto) : '') + ' · total ' + brl(p.total) + '<br>' + st.pagas + ' pagas · ' + (st.faltam ? 'faltam ' + st.faltam + ' (' + brl(st.restante) + ')' : 'quitada') + '</p><div class="sched">';
    st.list.forEach(function (x) {
      var paga = x.data < today(), prox = st.proxima && st.proxima.i === x.i;
      h += '<div class="ml' + (paga ? ' done' : '') + (prox ? ' next' : '') + '"><span>' + x.i + '/' + x.n + '</span><span>' + C.fmtDate(x.data) + '</span><b>' + brl(x.valor) + '</b><em>' + (paga ? 'paga' : prox ? 'próxima' : '') + '</em></div>';
    });
    h += '</div><div class="btns"><button class="btn danger" data-act="delparc" data-id="' + id + '">Excluir</button><button class="btn" data-act="editparc" data-id="' + id + '">Editar</button></div>';
    return h;
  }


  /* Sugestões e ajustes automáticos usando o histórico de lançamentos. */
  function updSmart() {
    if (!form) return;
    readForm();
    var f = form, key = C.normKey(f.desc), sugs = C.sugestoes(items, f.desc, f.kind, 5), exato = null;
    f.sugs = sugs;
    sugs.forEach(function (s) { if (key && s.key === key) exato = s; });
    var box = document.getElementById('f-chips');
    if (box) box.innerHTML = sugs.map(function (s, i) { return s === exato ? '' : '<button type="button" class="chip" data-act="chip" data-i="' + i + '">' + esc(s.desc) + '<small>' + brl(s.valor) + '</small></button>'; }).join('');
    var sc = document.getElementById('f-cat'), auto = C.makeCategorizer(items)(f.desc, f.kind);
    if (!f.catTouched && sc && f.desc.trim() && auto !== 'Outros') sc.value = auto;
    var sp = document.getElementById('f-pgto');
    if (exato && exato.pgto && !f.pgtoTouched && sp) { sp.value = exato.pgto; f.pgto = exato.pgto; if (f.parcelado && !f.primeiraTouched) setPrimeira(f); }
    var vi = document.getElementById('f-valor'); if (vi) vi.placeholder = exato ? String(exato.valor).replace('.', ',') : '0,00';
    var hs = [], v = C.parseMoneyExpr(f.valor);
    if (exato) hs.push('Última vez: <b>' + brl(exato.valor) + '</b> em ' + C.fmtDate(exato.ultimo) + ' · ' + exato.vezes + 'x' + (!String(f.valor).trim() ? ' <button type="button" class="chip mini" data-act="usarvalor">Usar valor</button>' : ''));
    var np = C.parcelasDoTexto(f.desc);
    if (np && f.kind === 'gasto' && !f.parcelado && !f.id) hs.push('Parece parcelado. <button type="button" class="chip mini" data-act="mkparc" data-n="' + np + '">Parcelar em ' + np + 'x</button>');
    var rc = !f.id && !f.fixo && !f.parcelado ? C.recorrencia(items, f.desc, f.kind) : null;
    if (rc) hs.push('Aparece todo mês (' + brl(rc.valor) + ', dia ' + rc.dia + '). <button type="button" class="chip mini" data-act="mkfixo">Repetir todo mês</button>');
    if (v > 0 && f.data && !f.id && !f.parcelado) {
      var dup = Object.keys(items).some(function (id) { var it = items[id]; return it && it.t === 'tx' && it.kind === f.kind && it.data === f.data && Math.round(it.valor * 100) === Math.round(v * 100); });
      if (dup) hs.push('<span class="warnline">Já existe um lançamento igual neste dia.</span>');
    }
    var hint = document.getElementById('f-hint'); if (hint) hint.innerHTML = hs.join('<br>');
    var cl = document.getElementById('f-calc'); if (cl) cl.textContent = String(f.valor).indexOf('+') >= 0 && v > 0 ? '= ' + brl(v) : '';
  }

  function renderSheet() {
    var sh = $('#sheet'), bg = $('#shbg');
    var html = form ? formHtml(form) : detail ? detailHtml(detail) : imp ? impHtml() : '';
    if (!html) { sh.className = 'sheet'; bg.className = 'shbg'; sh.innerHTML = ''; return; }
    // preserva o foco durante re-render do formulário
    var act = document.activeElement && document.activeElement.id, pos = null;
    if (act && document.activeElement.selectionStart != null) pos = document.activeElement.selectionStart;
    sh.innerHTML = html; sh.className = 'sheet open'; bg.className = 'shbg open';
    if (imp) updImp();
    if (form) updSmart();
    if (act && form) { var el = document.getElementById(act); if (el) { el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch (e) {} } }
  }

  function readForm() {
    var f = form; if (!f) return;
    var g = function (i) { var e = document.getElementById(i); return e ? e.value : null; };
    if (g('f-valor') !== null) f.valor = g('f-valor');
    if (g('f-desc') !== null) f.desc = g('f-desc');
    if (g('f-cat') !== null) f.cat = g('f-cat');
    if (g('f-data') !== null) f.data = g('f-data');
    if (g('f-pgto') !== null) f.pgto = g('f-pgto');
    if (g('f-n') !== null) f.n = g('f-n');
    if (g('f-prim') !== null) f.primeira = g('f-prim');
    if (g('f-fim') !== null) f.fim = g('f-fim');
  }

  function submit() {
    readForm(); var f = form;
    var v = C.parseMoneyExpr(f.valor);
    if (!(v > 0)) return toast('Informe um valor maior que zero.', true);
    if (!f.desc.trim()) return toast('Informe uma descrição.', true);
    if (!f.data) return toast('Informe a data.', true);
    var cats = f.kind === 'receita' ? C.CATS_R : C.CATS_G, cat = cats.indexOf(f.cat) >= 0 ? f.cat : cats[0];
    var pgto = f.kind === 'gasto' ? f.pgto : '';
    var id = f.id, obj;
    if (f.parcelado && f.kind === 'gasto') {
      var n = parseInt(f.n, 10);
      if (!(n >= 2 && n <= 72)) return toast('Número de parcelas entre 2 e 72.', true);
      if (!f.primeira) return toast('Informe o vencimento da 1ª parcela.', true);
      var total = f.modo === 'parcela' ? Math.round(v * n * 100) / 100 : v;
      obj = { t: 'parc', desc: f.desc.trim(), total: total, n: n, primeira: f.primeira, compra: f.data, cat: cat, pgto: pgto };
      id = id || uid('parc');
    } else if (f.fixo) {
      obj = { t: 'fixo', kind: f.kind, desc: f.desc.trim(), valor: v, cat: cat, dia: parseInt(f.data.slice(8), 10), inicio: f.data.slice(0, 7), fim: f.fim || null, pgto: pgto };
      id = id || uid('fixo');
    } else {
      obj = { t: 'tx', kind: f.kind, desc: f.desc.trim(), valor: v, cat: cat, data: f.data, pgto: pgto };
      id = id || uid('tx');
    }
    var auto = C.makeCategorizer(items)(f.desc, f.kind), key = C.normKey(f.desc), when = obj.t === 'parc' ? obj.primeira : obj.t === 'fixo' ? obj.inicio + '-01' : obj.data;
    form = null;
    var p = save(id, obj);
    if (cat !== auto && key) { var rid = 'rule_' + key.replace(/ /g, '_'), ro = { t: 'rule', key: key, cat: cat }; items[rid] = ro; window.Cloud.set(rid, ro).catch(function () {}); }
    var lim = C.orcamentos(items)[cat], msg = 'Salvo';
    if (lim > 0 && f.kind === 'gasto') {
      var gasto = C.summarize(C.entriesForMonth(items, when.slice(0, 7))).byCat[cat] || 0;
      msg = gasto > lim ? cat + ': passou do limite (' + brl(gasto) + ' de ' + brl(lim) + ')' : gasto >= lim * 0.8 ? cat + ': ' + C.pct(gasto / lim) + ' do limite' : 'Salvo';
      if (gasto > lim) { p.then(function () { toast(msg, true); }); return; }
    }
    p.then(function () { toast(msg); });
  }

  /* ---------- eventos ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act],[data-tab]'); if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
    var a = t.dataset.act;
    if (a === 'prev') { ym = C.addYm(ym, -1); render(); }
    else if (a === 'next') { ym = C.addYm(ym, 1); render(); }
    else if (a === 'pickym') { ym = t.dataset.ym; render(); }
    else if (a === 'chartn') { chartN = +t.dataset.n; render(); }
    else if (a === 'chip') { var sg = form && form.sugs[+t.dataset.i]; if (sg) { readForm(); form.desc = sg.desc; form.kind = sg.kind; form.cat = sg.cat; form.catTouched = true; if (sg.pgto) { form.pgto = sg.pgto; form.pgtoTouched = true; } if (!String(form.valor).trim()) form.valor = Number(sg.valor).toFixed(2).replace('.', ','); if (form.parcelado && !form.primeiraTouched) setPrimeira(form); renderSheet(); } }
    else if (a === 'usarvalor') { readForm(); var k2 = C.normKey(form.desc), s2 = form.sugs.filter(function (x) { return x.key === k2; })[0]; if (s2) { form.valor = String(s2.valor).replace('.', ','); renderSheet(); } }
    else if (a === 'mkfixo') { readForm(); form.fixo = true; form.parcelado = false; renderSheet(); }
    else if (a === 'mkparc') { readForm(); form.parcelado = true; form.fixo = false; form.n = +t.dataset.n; if (!form.primeiraTouched) form.primeira = defPrimeira(form); renderSheet(); }
    else if (a === 'dia') { readForm(); var dd = new Date(); dd.setDate(dd.getDate() + (+t.dataset.d)); form.data = C.todayStr(dd); if (form.parcelado && !form.primeiraTouched) form.primeira = defPrimeira(form); renderSheet(); }
    else if (a === 'fab') { form = newForm('gasto'); renderSheet(); }
    else if (a === 'close') { form = null; detail = null; imp = null; renderSheet(); }
    else if (a === 'impall' || a === 'impnone') { imp.rows.forEach(function (r) { r.sel = a === 'impall'; }); document.querySelectorAll('[data-ir]').forEach(function (c) { c.checked = a === 'impall'; }); updImp(); }
    else if (a === 'impinv') { invertImp(); }
    else if (a === 'impgo') doImport();
    else if (a === 'kind') { readForm(); form.kind = t.dataset.k; if (form.kind === 'receita') form.parcelado = false; form.cat = ''; renderSheet(); }
    else if (a === 'modo') { readForm(); form.modo = t.dataset.m; renderSheet(); }
    else if (a === 'submit') submit();
    else if (a === 'dlgno') { dlgCb = null; closeDlg(); }
    else if (a === 'dlgyes') { var cb = dlgCb; dlgCb = null; closeDlg(); if (cb) cb(); }
    else if (a === 'del') { var id = form.id; ask('Excluir este lançamento?', 'Excluir', function () { form = null; remove(id); }); }
    else if (a === 'open') openEdit(t.dataset.src, t.dataset.tipo);
    else if (a === 'parc') { detail = t.dataset.id; renderSheet(); }
    else if (a === 'editparc') editParc(t.dataset.id);
    else if (a === 'delparc') { var did = t.dataset.id; ask('Excluir esta compra parcelada e todas as parcelas?', 'Excluir', function () { detail = null; remove(did); }); }
    else if (a === 'quit') { showQuitadas = !showQuitadas; render(); }
    else if (a === 'saveorc') saveOrc();
    else if (a === 'clearlocal') ask('Apagar todos os dados do modo teste neste aparelho? Isso não afeta a nuvem.', 'Apagar tudo', function () { window.Cloud.clearLocal(); items = {}; render(); toast('Dados de teste apagados'); });
    else if (a === 'saveme') { var nm = ($('#me-nome').value || '').trim(); if (nm) { save('cfg_me', { t: 'cfg', nome: nm }).then(function () { toast('Nome salvo'); }); } else if (items.cfg_me) { remove('cfg_me'); toast('Nome removido'); } }
    else if (a === 'export') exportJson();
    else if (a === 'lock') ask(window.Cloud.isLocal() ? 'Sair do modo teste? Os dados de exemplo ficam guardados neste aparelho.' : 'Bloquear este aparelho? Será preciso digitar a senha de novo.', window.Cloud.isLocal() ? 'Sair' : 'Bloquear', function () { window.Cloud.lock(); location.reload(); });
    else if (a === 'local') { window.Cloud.useLocal(); enter(); }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'f-parc') { readForm(); form.parcelado = t.checked; if (t.checked) { form.fixo = false; if (!form.primeiraTouched) form.primeira = defPrimeira(form); } renderSheet(); }
    else if (t.id === 'ch-cat') { chartCat = t.value; render(); }
    else if (t.id === 'f-pgto' && form) { form.pgto = t.value; form.pgtoTouched = true; if (form.parcelado && !form.primeiraTouched) { setPrimeira(form); updPrev(); } }
    else if (t.id === 'f-fixo') { readForm(); form.fixo = t.checked; renderSheet(); }
    else if (t.id === 'f-data' && form) { form.data = t.value; if (form.parcelado && !form.primeiraTouched) { setPrimeira(form); updPrev(); } updSmart(); }
    else if (t.id === 'f-prim' && form) { form.primeiraTouched = true; form.primeira = t.value; updPrev(); }
    else if (t.id === 'imp') importJson(t.files[0]);
    else if (t.id === 'f-cat' && form) { form.catTouched = true; }
    else if (t.id === 'impx') { readStatement(t.files[0]); t.value = ''; }
    else if (imp && t.dataset.ir !== undefined) { imp.rows[+t.dataset.ir].sel = t.checked; updImp(); }
    else if (imp && t.dataset.ic !== undefined) {
      var row = imp.rows[+t.dataset.ic], key = C.normKey(row.desc);
      row.cat = t.value; row.touched = true;
      if (key) imp.rows.forEach(function (o) {
        if (o !== row && !o.touched && o.kind === row.kind && C.normKey(o.desc) === key) {
          o.cat = t.value;
          var el = document.querySelector('[data-ic="' + o.i + '"]'); if (el) el.value = t.value;
        }
      });
    }
  });

  document.addEventListener('input', function (e) {
    if (form && (e.target.id === 'f-valor' || e.target.id === 'f-n')) { readForm(); updPrev(); }
    if (form && (e.target.id === 'f-desc' || e.target.id === 'f-valor')) updSmart();
  });

  function updPrev() { var el = document.getElementById('f-prev'); if (el && form) { readForm(); el.textContent = preview(form); } }

  $('#shbg').addEventListener('click', function () { if (imp) return; form = null; detail = null; renderSheet(); });

  function saveOrc() {
    var inputs = document.querySelectorAll('[data-orc]'), jobs = [];
    inputs.forEach(function (i) {
      var cat = i.dataset.orc, v = C.parseMoney(i.value), id = 'orc_' + cat, cur = items[id];
      if (v > 0 && (!cur || cur.limite !== v)) { items[id] = { t: 'orc', cat: cat, limite: v }; jobs.push(window.Cloud.set(id, items[id])); }
      else if (!(v > 0) && cur) { delete items[id]; jobs.push(window.Cloud.del(id)); }
    });
    Promise.all(jobs).then(function () { toast('Orçamento salvo'); render(); }, function () { toast('Falha ao salvar o orçamento.', true); });
  }

  function exportJson() {
    var data = JSON.stringify({ app: 'financas', versao: 1, exportado: new Date().toISOString(), itens: items }, null, 2);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = 'financas-backup-' + today() + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function importJson(file) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var j = JSON.parse(r.result), it = j.itens; if (!it || typeof it !== 'object') throw 0;
        var ids = Object.keys(it).filter(function (id) { return it[id] && /^(tx|parc|fixo|orc|rule|cfg)$/.test(it[id].t); });
        if (!ids.length) throw 0;
        ask('Importar ' + ids.length + ' itens? Itens com o mesmo código serão substituídos.', 'Importar', function () {
          Promise.all(ids.map(function (id) { items[id] = it[id]; return window.Cloud.set(id, it[id]); })).then(function () { toast('Importado'); render(); }, function () { toast('Falha na importação.', true); });
        });
      } catch (e) { toast('Arquivo de backup inválido.', true); }
    };
    r.readAsText(file);
  }


  /* ---------- importação de extrato ---------- */
  function readStatement(file) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () {
      var text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(r.result); } catch (e) { text = new TextDecoder('windows-1252').decode(r.result); }
      var res = C.parseStatement(text);
      if (!res.rows.length) return toast(res.erro || 'Não encontrei lançamentos nesse arquivo.', true);
      imp = { nome: file.name, aviso: res.aviso || '', raw: res.rows, rows: [] };
      buildImp();
      form = null; detail = null; renderSheet();
    };
    r.onerror = function () { toast('Não consegui ler o arquivo.', true); };
    r.readAsArrayBuffer(file);
  }

  function buildImp() {
    var cat = C.makeCategorizer(items), me = (items.cfg_me && items.cfg_me.nome) || '';
    imp.rows = imp.raw.map(function (x, i) {
      var kind = x.valor < 0 ? 'gasto' : 'receita', c = cat(x.desc, kind);
      return { i: i, data: x.data, v: Math.abs(x.valor), kind: kind, desc: x.desc, ref: x.ref || '', cat: c, auto: c, ign: C.ignoravel(x.desc, me), dup: '', sel: true, estorno: false, touched: false };
    });
    C.marcarDuplicados(imp.rows, items);
    C.parearEstornos(imp.rows);
    imp.rows.forEach(function (r) { r.sel = !r.dup && !r.ign && !r.estorno; });
  }

  function invertImp() {
    imp.raw = imp.raw.map(function (x) { return { data: x.data, valor: -x.valor, desc: x.desc, ref: x.ref }; });
    buildImp(); renderSheet(); toast('Sinais invertidos');
  }

  function impHtml() {
    var h = '<div class="sh-h"><b>Importar extrato</b><button data-act="close" aria-label="Fechar">✕</button></div>' +
      '<p class="muted small">' + esc(imp.nome) + ' · ' + imp.rows.length + ' lançamentos. Confira as categorias; as que você mudar viram regra para os próximos extratos.</p>';
    if (imp.aviso) h += '<p class="tip warn small"><b>Atenção</b><span>' + esc(imp.aviso) + '</span></p>';
    h += '<div class="itools"><button class="link" data-act="impall">Marcar todos</button><button class="link" data-act="impnone">Limpar</button><button class="link" data-act="impinv">Inverter sinais</button></div>';
    imp.rows.forEach(function (r) {
      var cats = r.kind === 'receita' ? C.CATS_R : C.CATS_G;
      h += '<div class="ir"><label class="ick"><input type="checkbox" data-ir="' + r.i + '"' + (r.sel ? ' checked' : '') + ' aria-label="Importar este lançamento"></label><div class="ib">' +
        '<div class="it"><span class="id">' + C.fmtDate(r.data).slice(0, 5) + '</span><b>' + esc(r.desc) + '</b><strong class="' + (r.kind === 'receita' ? 'pos' : 'neg') + '">' + (r.kind === 'receita' ? '+' : '-') + brl(r.v) + '</strong></div>' +
        '<div class="is"><select data-ic="' + r.i + '" aria-label="Categoria">' + opts(cats, r.cat) + '</select>' +
        (r.dup === 'ref' ? '<em>já importado</em>' : r.dup === 'val' ? '<em>já lançado?</em>' : '') + (r.ign ? '<em>fatura/transferência?</em>' : '') + (r.estorno ? '<em>estornado</em>' : '') + '</div></div></div>';
    });
    h += '<div class="ifoot"><p class="muted small" id="imp-sum"></p><button class="btn" data-act="impgo" id="imp-go">Importar</button></div>';
    return h;
  }

  function updImp() {
    if (!imp) return;
    var sel = imp.rows.filter(function (r) { return r.sel; });
    var g = sel.filter(function (r) { return r.kind === 'gasto'; }).reduce(function (a, r) { return a + r.v; }, 0);
    var rc = sel.filter(function (r) { return r.kind === 'receita'; }).reduce(function (a, r) { return a + r.v; }, 0);
    var s = document.getElementById('imp-sum'), b = document.getElementById('imp-go');
    if (s) s.textContent = sel.length + ' marcados · gastos ' + brl(g) + ' · receitas ' + brl(rc);
    if (b) { b.textContent = sel.length ? 'Importar ' + sel.length : 'Importar'; b.disabled = !sel.length; }
  }

  function doImport() {
    var sel = imp.rows.filter(function (r) { return r.sel; });
    if (!sel.length) return toast('Nenhum lançamento marcado.', true);
    var jobs = [], last = '';
    sel.forEach(function (r) {
      var id = uid('tx'), obj = { t: 'tx', kind: r.kind, desc: r.desc, valor: r.v, cat: r.cat, data: r.data, pgto: r.kind === 'gasto' ? C.pgtoDe(r.desc) : '' };
      if (r.ref) obj.ref = r.ref;
      items[id] = obj; jobs.push(window.Cloud.set(id, obj));
      if (r.data > last) last = r.data;
    });
    var learned = {};
    imp.rows.forEach(function (r) {
      if (!r.sel || r.cat === r.auto) return;
      var k = C.normKey(r.desc); if (!k) return;
      learned['rule_' + k.replace(/ /g, '_')] = { t: 'rule', key: k, cat: r.cat };
    });
    Object.keys(learned).forEach(function (id) { items[id] = learned[id]; jobs.push(window.Cloud.set(id, learned[id])); });
    var n = sel.length;
    imp = null; tab = 'lanc'; ym = last.slice(0, 7); render(); window.scrollTo(0, 0);
    Promise.all(jobs).then(function () { toast(n + ' lançamentos importados'); }, function () { toast('Alguns lançamentos não foram para a nuvem. Atualizando…', true); window.Cloud.pull(true); });
  }

  /* ---------- trava por senha + início ---------- */
  function lockUI(html) { $('#lock').innerHTML = '<div class="lb"><h2>Finanças</h2>' + html + '</div>'; }

  function attState() { try { return JSON.parse(localStorage.getItem('fin:att') || '{}'); } catch (e) { return {}; } }
  function attSet(o) { try { localStorage.setItem('fin:att', JSON.stringify(o)); } catch (e) {} }

  function showPassToggle() {
    var c = $('#pshow'); if (!c) return;
    c.onchange = function () { document.querySelectorAll('#lock input[type=password], #lock input[data-pw]').forEach(function (i) { i.type = c.checked ? 'text' : 'password'; i.setAttribute('data-pw', '1'); }); };
  }

  function askSetup() {
    lockUI('<p>Primeiro acesso. Crie uma senha para proteger seus dados (mínimo 8 caracteres). Ela é pedida toda vez que você abrir o app e <b>não pode ser recuperada</b>: se esquecer, os dados ficam ilegíveis.</p>' +
      '<input id="p1" type="password" autocomplete="new-password" placeholder="senha"><input id="p2" type="password" autocomplete="new-password" placeholder="repita a senha">' +
      '<label class="chk lite"><input type="checkbox" id="pshow"> Mostrar senha</label><div class="e" id="pe"></div><button class="btn" id="pb">Criar senha</button>');
    showPassToggle();
    var go = function () {
      var a = $('#p1').value, b = $('#p2').value, e = $('#pe');
      if (a.length < 8) { e.textContent = 'Use pelo menos 8 caracteres.'; return; }
      if (a !== b) { e.textContent = 'As senhas não são iguais.'; return; }
      $('#pb').disabled = true; e.textContent = 'Criando…';
      window.Cloud.setup(a).then(enter, function () { e.textContent = 'Falha ao salvar. Tente de novo.'; $('#pb').disabled = false; });
    };
    $('#pb').onclick = go;
    $('#p2').onkeydown = function (ev) { if (ev.key === 'Enter') go(); };
  }

  function askPass() {
    lockUI('<p>Digite a senha para entrar.</p><input id="p1" type="password" autocomplete="current-password" placeholder="senha">' +
      '<label class="chk lite"><input type="checkbox" id="pshow"> Mostrar senha</label><div class="e" id="pe"></div><button class="btn" id="pb">Entrar</button>');
    showPassToggle();
    var tmr = null;
    function espera() {
      var s = attState(), left = Math.ceil(((s.until || 0) - Date.now()) / 1000), e = $('#pe'), b = $('#pb');
      if (!e || !b) return clearInterval(tmr);
      if (left > 0) { b.disabled = true; e.textContent = 'Muitas tentativas. Aguarde ' + left + 's.'; }
      else { clearInterval(tmr); b.disabled = false; if (/Aguarde/.test(e.textContent)) e.textContent = ''; }
    }
    espera(); if ((attState().until || 0) > Date.now()) tmr = setInterval(espera, 1000);
    var go = function () {
      if ((attState().until || 0) > Date.now()) return;
      var e = $('#pe'); $('#pb').disabled = true; e.textContent = 'Verificando…';
      window.Cloud.unlock($('#p1').value).then(function () { attSet({}); enter(); }, function () {
        var s = attState(), n = (s.n || 0) + 1, wait = n >= 5 ? Math.min(900, 15 * Math.pow(2, n - 5)) : 0;
        attSet({ n: n, until: Date.now() + wait * 1000 });
        e.textContent = 'Senha incorreta.'; $('#pb').disabled = false; $('#p1').value = ''; $('#p1').focus();
        if (wait) { clearInterval(tmr); tmr = setInterval(espera, 1000); espera(); }
      });
    };
    $('#pb').onclick = go;
    $('#p1').onkeydown = function (ev) { if (ev.key === 'Enter') go(); };
    setTimeout(function () { var i = $('#p1'); if (i) i.focus(); }, 50);
  }

  function failUI() {
    lockUI('<p>Não consegui falar com o servidor. Verifique a internet.</p><button class="btn" id="pb">Tentar de novo</button><button class="btn sec" data-act="local">Testar sem nuvem (dados de exemplo)</button>');
    $('#pb').onclick = boot;
  }

  function enter() {
    $('#lock').remove();
    $('#app').dataset.on = '1';
    $('#demo').hidden = !window.Cloud.isLocal();
    render();
    window.Cloud.start(function (it) { items = it; render(); }, function (s) { sync = s; var el = $('#sync'); if (el) { el.dataset.s = s; el.title = s === 'ok' ? 'Sincronizado' : 'Sem conexão'; } });
  }

  function boot() {
    lockUI('<p>Conectando…</p>');
    window.Cloud.getMeta().then(function (meta) {
      if (!meta) return askSetup();
      window.Cloud.tryRemembered().then(function () { askPass(); });
    }, failUI);
  }

  /* Bloqueio automático: 5 min sem uso, ou 2 min com o app em segundo plano. */
  var lastAct = Date.now(), hiddenAt = 0;
  ['click', 'keydown', 'touchstart', 'scroll'].forEach(function (ev) { document.addEventListener(ev, function () { lastAct = Date.now(); }, { passive: true, capture: true }); });
  function lockNow() { window.Cloud.lock(); location.reload(); }
  setInterval(function () { if ($('#app').dataset.on && !window.Cloud.isLocal() && Date.now() - lastAct > 5 * 60000) lockNow(); }, 15000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && $('#app').dataset.on && !window.Cloud.isLocal() && Date.now() - hiddenAt > 2 * 60000) lockNow();
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(function () {});

  document.getElementById('sync').addEventListener('click', function () { window.Cloud.pull(true); toast('Atualizando…'); });
  boot();
})();
