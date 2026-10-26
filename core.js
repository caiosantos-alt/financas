/* Lógica pura do app de finanças (sem DOM): datas, parcelas, resumo e dicas. */
(function (root) {
  var CATS_G = ['Mercado', 'Restaurantes', 'Transporte', 'Moradia', 'Contas', 'Saúde', 'Lazer', 'Compras', 'Assinaturas', 'Educação', 'Viagem', 'Transferências', 'Outros'];
  var CATS_R = ['Salário', 'Extra', 'Outros'];
  var PGTOS = ['Cartão de crédito', 'Débito', 'Pix', 'Dinheiro', 'Boleto'];
  var MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  function pad(n) { return String(n).padStart(2, '0'); }

  function todayStr(now) {
    var d = now || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function addMonths(dateStr, k) {
    var p = dateStr.split('-').map(Number);
    var t = p[0] * 12 + (p[1] - 1) + k;
    var ny = Math.floor(t / 12), nm = (t % 12) + 1;
    var last = new Date(ny, nm, 0).getDate();
    return ny + '-' + pad(nm) + '-' + pad(Math.min(p[2], last));
  }

  function addYm(ym, k) {
    var p = ym.split('-').map(Number);
    var t = p[0] * 12 + (p[1] - 1) + k;
    return Math.floor(t / 12) + '-' + pad((t % 12) + 1);
  }

  function ymLabel(ym) {
    var p = ym.split('-').map(Number);
    return MESES[p[1] - 1] + ' ' + p[0];
  }

  function ymShort(ym) {
    var p = ym.split('-').map(Number);
    return MESES[p[1] - 1].slice(0, 3) + '/' + String(p[0]).slice(2);
  }

  function daysInYm(ym) {
    var p = ym.split('-').map(Number);
    return new Date(p[0], p[1], 0).getDate();
  }

  function fmtDate(d) {
    var p = d.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  /* "1.234,56" | "1234.56" | "R$ 12,5" -> 1234.56 */
  function parseMoney(s) {
    if (typeof s === 'number') return s;
    s = String(s || '').replace(/[R$\s]/g, '');
    if (!s) return NaN;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var v = parseFloat(s);
    return isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  }

  /* Lista de parcelas de uma compra parcelada.
     p = { total, n, primeira:'YYYY-MM-DD' }. Divide em centavos; a última absorve o resto. */
  function parcelas(p) {
    var n = Math.max(1, p.n | 0);
    var cents = Math.round(p.total * 100);
    var each = Math.floor(cents / n);
    var out = [];
    for (var i = 0; i < n; i++) {
      var c = i === n - 1 ? cents - each * (n - 1) : each;
      out.push({ i: i + 1, n: n, data: addMonths(p.primeira, i), valor: c / 100 });
    }
    return out;
  }

  /* Uma parcela já foi debitada quando a data de vencimento ficou para trás. */
  function parcStatus(p, today) {
    var list = parcelas(p);
    var pagas = list.filter(function (x) { return x.data < today; });
    var abertas = list.filter(function (x) { return x.data >= today; });
    var restante = abertas.reduce(function (a, x) { return a + x.valor; }, 0);
    return {
      list: list,
      pagas: pagas.length,
      faltam: abertas.length,
      proxima: abertas[0] || null,
      restante: Math.round(restante * 100) / 100,
      parcela: list[0].valor
    };
  }

  /* Tudo que cai em um mês: lançamentos avulsos, parcelas que vencem e fixos. */
  function entriesForMonth(items, ym) {
    var out = [];
    Object.keys(items).forEach(function (id) {
      var it = items[id];
      if (!it || !it.t) return;
      if (it.t === 'tx') {
        if (it.data.slice(0, 7) === ym) {
          out.push({ src: id, kind: it.kind, desc: it.desc, valor: it.valor, cat: it.cat, data: it.data, pgto: it.pgto || '', tipo: 'tx' });
        }
      } else if (it.t === 'parc') {
        parcelas(it).forEach(function (x) {
          if (x.data.slice(0, 7) === ym) {
            out.push({ src: id, kind: 'gasto', desc: it.desc + ' (' + x.i + '/' + x.n + ')', valor: x.valor, cat: it.cat, data: x.data, pgto: it.pgto || '', tipo: 'parc' });
          }
        });
      } else if (it.t === 'fixo') {
        if (it.inicio <= ym && (!it.fim || it.fim >= ym)) {
          var d = Math.min(it.dia || 1, daysInYm(ym));
          out.push({ src: id, kind: it.kind, desc: it.desc, valor: it.valor, cat: it.cat, data: ym + '-' + pad(d), pgto: it.pgto || '', tipo: 'fixo' });
        }
      }
    });
    out.sort(function (a, b) { return a.data < b.data ? 1 : a.data > b.data ? -1 : 0; });
    return out;
  }

  function summarize(entries) {
    var r = 0, g = 0, byCat = {}, parcelasTotal = 0;
    entries.forEach(function (e) {
      if (e.kind === 'receita') r += e.valor;
      else {
        g += e.valor;
        byCat[e.cat] = (byCat[e.cat] || 0) + e.valor;
        if (e.tipo === 'parc') parcelasTotal += e.valor;
      }
    });
    var cats = Object.keys(byCat).map(function (c) { return { cat: c, valor: byCat[c] }; })
      .sort(function (a, b) { return b.valor - a.valor; });
    return {
      receitas: r, despesas: g, saldo: r - g, cats: cats, byCat: byCat, parcelas: parcelasTotal,
      poupanca: r > 0 ? (r - g) / r : null
    };
  }

  /* Valor que as parcelas abertas vão pesar em cada um dos próximos meses. */
  function projecaoParcelas(items, fromYm, meses) {
    var out = [];
    for (var k = 0; k < meses; k++) {
      var ym = addYm(fromYm, k), tot = 0;
      Object.keys(items).forEach(function (id) {
        var it = items[id];
        if (it && it.t === 'parc') parcelas(it).forEach(function (x) { if (x.data.slice(0, 7) === ym) tot += x.valor; });
      });
      out.push({ ym: ym, valor: Math.round(tot * 100) / 100 });
    }
    return out;
  }

  function orcamentos(items) {
    var o = {};
    Object.keys(items).forEach(function (id) {
      var it = items[id];
      if (it && it.t === 'orc') o[it.cat] = it.limite;
    });
    return o;
  }

  function brl(v) {
    return (v < 0 ? '-' : '') + 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pct(x) { return Math.round(x * 100) + '%'; }

  /* Dicas de economia e saúde financeira para o mês ym. */
  function insights(items, ym, today) {
    var tips = [];
    var cur = summarize(entriesForMonth(items, ym));
    var prev = summarize(entriesForMonth(items, addYm(ym, -1)));
    var orc = orcamentos(items);
    var isCur = today.slice(0, 7) === ym;

    if (cur.receitas === 0 && cur.despesas === 0) {
      return [{ tone: 'info', title: 'Sem dados neste mês', text: 'Lance seus gastos e receitas para receber dicas personalizadas.' }];
    }

    if (cur.poupanca !== null) {
      if (cur.poupanca < 0) tips.push({ tone: 'bad', title: 'Gastando mais do que ganha', text: 'As despesas passaram as receitas em ' + brl(-cur.saldo) + '. Veja as categorias que mais pesam e corte primeiro o que não é essencial.' });
      else if (cur.poupanca < 0.1) tips.push({ tone: 'warn', title: 'Sobra baixa (' + pct(cur.poupanca) + ' da renda)', text: 'Uma meta comum é guardar de 10% a 20% da renda. Hoje sobram ' + brl(cur.saldo) + '.' });
      else tips.push({ tone: 'good', title: 'Você está guardando ' + pct(cur.poupanca) + ' da renda', text: 'Sobram ' + brl(cur.saldo) + ' neste mês. Vale separar esse valor assim que a receita entrar.' });
    }

    var proxYm = addYm(ym, 1);
    var proxParc = projecaoParcelas(items, proxYm, 1)[0].valor;
    var rendaRef = cur.receitas || prev.receitas;
    if (rendaRef > 0 && cur.parcelas > 0) {
      var share = cur.parcelas / rendaRef;
      if (share >= 0.3) tips.push({ tone: 'warn', title: 'Parcelas comprometem ' + pct(share) + ' da renda', text: 'São ' + brl(cur.parcelas) + ' em parcelas neste mês. Acima de 30% o orçamento fica apertado; evite novas compras parceladas até as atuais diminuírem.' });
      else tips.push({ tone: 'info', title: 'Parcelas: ' + pct(share) + ' da renda', text: 'São ' + brl(cur.parcelas) + ' neste mês e ' + brl(proxParc) + ' no mês seguinte.' });
    }

    Object.keys(orc).forEach(function (c) {
      var gasto = cur.byCat[c] || 0, lim = orc[c];
      if (lim > 0 && gasto > lim) tips.push({ tone: 'bad', title: c + ': estourou o limite', text: 'Gasto de ' + brl(gasto) + ' para um limite de ' + brl(lim) + ' (' + brl(gasto - lim) + ' acima).' });
      else if (lim > 0 && gasto >= lim * 0.8) tips.push({ tone: 'warn', title: c + ': ' + pct(gasto / lim) + ' do limite', text: 'Restam ' + brl(lim - gasto) + ' de ' + brl(lim) + '.' });
    });

    var subidas = cur.cats.map(function (c) { return { cat: c.cat, cur: c.valor, prev: prev.byCat[c.cat] || 0 }; })
      .filter(function (c) { return c.prev > 0 && c.cur - c.prev >= 50 && c.cur / c.prev >= 1.2; })
      .sort(function (a, b) { return (b.cur - b.prev) - (a.cur - a.prev); }).slice(0, 2);
    subidas.forEach(function (c) {
      tips.push({ tone: 'warn', title: c.cat + ' subiu ' + pct(c.cur / c.prev - 1), text: 'Foram ' + brl(c.cur) + ' contra ' + brl(c.prev) + ' no mês anterior.' });
    });

    if (cur.cats.length && cur.despesas > 0) {
      var top = cur.cats[0];
      if (top.valor / cur.despesas >= 0.35) tips.push({ tone: 'info', title: top.cat + ' é ' + pct(top.valor / cur.despesas) + ' dos gastos', text: 'Maior categoria do mês (' + brl(top.valor) + '). Pequenos ajustes aqui rendem mais que cortes nas demais.' });
    }

    var subs = cur.byCat['Assinaturas'] || 0;
    if (subs > 0) tips.push({ tone: 'info', title: 'Assinaturas: ' + brl(subs) + '/mês', text: 'Em 12 meses são ' + brl(subs * 12) + '. Revise as que você quase não usa.' });

    var pequenos = entriesForMonth(items, ym).filter(function (e) { return e.kind === 'gasto' && e.tipo === 'tx' && e.valor < 30; });
    if (pequenos.length >= 8) {
      var soma = pequenos.reduce(function (a, e) { return a + e.valor; }, 0);
      tips.push({ tone: 'info', title: pequenos.length + ' gastos pequenos somam ' + brl(soma), text: 'Compras abaixo de R$ 30 passam despercebidas, mas pesam no fim do mês.' });
    }

    if (isCur && cur.despesas > 0) {
      var dia = Math.max(1, parseInt(today.slice(8), 10));
      var avulsos = entriesForMonth(items, ym).filter(function (e) { return e.kind === 'gasto' && e.tipo === 'tx' && e.data <= today; })
        .reduce(function (a, e) { return a + e.valor; }, 0);
      var fixosParc = cur.despesas - entriesForMonth(items, ym).filter(function (e) { return e.kind === 'gasto' && e.tipo === 'tx'; }).reduce(function (a, e) { return a + e.valor; }, 0);
      var proj = fixosParc + (avulsos / dia) * daysInYm(ym);
      if (avulsos > 0) tips.push({ tone: 'info', title: 'No ritmo atual, o mês fecha em ' + brl(proj), text: 'Cálculo: gastos avulsos até hoje projetados para o mês inteiro, mais parcelas e contas fixas.' });
    }

    return tips;
  }


  /* ---------- Importação de extrato (CSV / OFX) ---------- */
  function stripAcc(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function parseDate(s) {
    s = String(s || '').trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{4})(\d{2})(\d{2})(?:\d{6})?/);
    var y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})\b/);
      if (!m) return null;
      d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    return y + '-' + pad(mo) + '-' + pad(d);
  }

  /* Valor em formato brasileiro ou internacional, com sinal. */
  function parseAmount(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return NaN;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
    if (/^(R\$)?\s*[-−]/.test(s)) neg = true;
    s = s.replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) return NaN;
    var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) { s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''); }
    else if (lc >= 0) { s = s.replace(/\./g, '').replace(',', '.'); }
    else if (ld >= 0 && (s.match(/\./g) || []).length > 1) { s = s.replace(/\./g, ''); }
    var v = parseFloat(s);
    if (!isFinite(v)) return NaN;
    return (neg ? -1 : 1) * Math.round(v * 100) / 100;
  }

  function detectDelim(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); }).slice(0, 12), best = ',', bc = -1;
    [';', '\t', ','].forEach(function (d) {
      var c = lines.reduce(function (a, l) { return a + (l.split(d).length - 1); }, 0);
      if (c > bc) { bc = c; best = d; }
    });
    return best;
  }

  function parseCsvRows(text, delim) {
    var rows = [], row = [], f = '', q = false, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = '';
        if (row.some(function (c) { return c.trim(); })) rows.push(row);
        row = [];
      } else f += ch;
    }
    row.push(f);
    if (row.some(function (c) { return c.trim(); })) rows.push(row);
    return rows;
  }

  function findCols(h) {
    var cols = { data: -1, valor: -1, deb: -1, cred: -1, tipo: -1, id: -1, desc: [] };
    h.forEach(function (raw, i) {
      var c = stripAcc(raw).toLowerCase().trim();
      if (cols.data < 0 && /^(data|date|dt\b)/.test(c)) cols.data = i;
      else if (/^(debito|saida)/.test(c)) cols.deb = i;
      else if (/^(credito|entrada)/.test(c)) cols.cred = i;
      else if (cols.valor < 0 && /^(valor|amount|montante|quantia)/.test(c)) cols.valor = i;
      else if (cols.tipo < 0 && /^(tipo|natureza|d\/c|dc)$/.test(c)) cols.tipo = i;
      else if (cols.id < 0 && /(identificador|fitid|^id$|documento|docto)/.test(c)) cols.id = i;
      else if (/(descri|historico|lancamento|title|titulo|estabelecimento|memo|nome|detalhe)/.test(c)) cols.desc.push(i);
    });
    return cols;
  }

  /* Junta as colunas de texto, tira os rótulos genéricos do banco e o ruído do fim ("BRA. Cartão 9040"). */
  function limpaDesc(parts) {
    var GEN = /^(debito de cartao|credito de cartao|transf(erencia)? enviada pix( c)?|transf(erencia)? recebida pix)$/;
    var keep = parts.filter(function (p) { return !GEN.test(stripAcc(p).toLowerCase().replace(/\s+/g, ' ').trim()); });
    if (!keep.length) keep = parts;
    return keep.join(' - ').replace(/\s{2,}/g, ' ').replace(/\s+BRA\.?\s+Cart[a\u00e3\u00c3]o\s+\d+\s*$/i, '').replace(/\s+Cart[a\u00e3\u00c3]o\s+\d{3,4}\s*$/i, '').trim();
  }

  function parseCsv(text) {
    var rows = parseCsvRows(text, detectDelim(text)), out = [], hi = -1, cols = null, i;
    for (i = 0; i < Math.min(rows.length, 40); i++) {
      var c = findCols(rows[i]);
      if (c.data >= 0 && (c.valor >= 0 || c.deb >= 0 || c.cred >= 0)) { hi = i; cols = c; break; }
    }
    var temSinal = false;
    for (i = hi + 1; i < rows.length; i++) {
      var r = rows[i], data, valor = NaN, desc = '', ref = '';
      if (cols) {
        data = parseDate(r[cols.data]);
        if (cols.valor >= 0) valor = parseAmount(r[cols.valor]);
        if (cols.deb >= 0 || cols.cred >= 0) {
          var dv = cols.deb >= 0 ? parseAmount(r[cols.deb]) : NaN, cv = cols.cred >= 0 ? parseAmount(r[cols.cred]) : NaN;
          if (isFinite(cv) && cv !== 0) { valor = Math.abs(cv); temSinal = true; }
          else if (isFinite(dv) && dv !== 0) { valor = -Math.abs(dv); temSinal = true; }
        }
        if (cols.tipo >= 0 && isFinite(valor)) {
          var tp = stripAcc(r[cols.tipo] || '').toLowerCase().trim();
          if (/^(d|deb|saida)/.test(tp)) { valor = -Math.abs(valor); temSinal = true; }
          else if (/^(c|cred|entrada)/.test(tp)) { valor = Math.abs(valor); temSinal = true; }
        }
        var parts = [];
        cols.desc.forEach(function (k) { var t = (r[k] || '').replace(/\s+/g, ' ').trim(); if (t && parts.indexOf(t) < 0) parts.push(t); });
        desc = limpaDesc(parts);
        if (cols.id >= 0) ref = (r[cols.id] || '').trim();
      } else {
        var di = -1, vi = -1;
        r.forEach(function (cell, k) { if (di < 0 && parseDate(cell)) di = k; });
        r.forEach(function (cell, k) { if (vi < 0 && k !== di && /^[\sR$()\-−\d.,]+-?$/.test(cell.trim()) && isFinite(parseAmount(cell)) && /[,.]\d{2}\s*$/.test(cell)) vi = k; });
        if (di < 0 || vi < 0) continue;
        data = parseDate(r[di]); valor = parseAmount(r[vi]);
        r.forEach(function (cell, k) { if (k !== di && k !== vi && cell.trim().length > desc.length) desc = cell.trim(); });
      }
      if (!data || !isFinite(valor) || valor === 0) continue;
      if (valor < 0) temSinal = true;
      out.push({ data: data, valor: valor, desc: desc || 'Sem descrição', ref: ref });
    }
    return { rows: out, temSinal: temSinal };
  }

  function parseOfx(text) {
    var blocks = text.split(/<STMTTRN>/i).slice(1), out = [];
    function tag(b, t) { var m = b.match(new RegExp('<' + t + '>([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : ''; }
    blocks.forEach(function (b) {
      var data = parseDate(tag(b, 'DTPOSTED')), a = tag(b, 'TRNAMT').replace(',', '.'), valor = parseFloat(a);
      if (!data || !isFinite(valor) || valor === 0) return;
      var desc = tag(b, 'MEMO') || tag(b, 'NAME') || 'Sem descrição';
      out.push({ data: data, valor: Math.round(valor * 100) / 100, desc: desc, ref: tag(b, 'FITID') });
    });
    return { rows: out, temSinal: true };
  }

  /* Lê o texto de um extrato (OFX ou CSV) e devolve { rows:[{data,valor(com sinal),desc,ref}], aviso, erro }. */
  function parseStatement(text) {
    text = String(text || '').replace(/^﻿/, '');
    var res = /<OFX|<STMTTRN>/i.test(text) ? parseOfx(text) : parseCsv(text), aviso = '';
    if (!res.rows.length) return { rows: [], erro: 'Não encontrei lançamentos. Use um arquivo CSV ou OFX exportado pelo app ou site do banco.' };
    if (!res.temSinal) {
      res.rows.forEach(function (r) { r.valor = -r.valor; });
      aviso = 'Todos os valores vieram positivos, então tratei como gastos (típico de fatura de cartão). Se estiver errado, toque em “Inverter sinais”.';
    }
    return { rows: res.rows.slice(0, 1500), aviso: aviso };
  }

  /* Chave estável do estabelecimento: tira prefixos de operação, números e pontuação. */
  function normKey(desc) {
    var s = stripAcc(desc).toUpperCase();
    s = s.replace(/\b(COMPRA|COMPRAS|PAGAMENTO|PAGTO|PGTO|PIX|TED|DOC|TRANSF|TRANSFERENCIA|ENVIADO|ENVIADA|RECEBIDO|RECEBIDA|NO|NA|DE|DO|DA|EM|DEBITO|CREDITO|CARTAO|VISTA|PARCELA|PARC|COM|PARA|REF|PELO|PELA|POR|VIA|AO|OS|AS|PAGO)\b/g, ' ');
    s = s.replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.split(' ').filter(function (w) { return w.length > 1; }).slice(0, 3).join(' ').slice(0, 40);
  }

  var REGRAS = [
    ['Moradia', /alugue|condomin|iptu|imobili/],
    ['Lazer', /bondinho|sympla|ingresso|zig\*|\bzig\b|cinema|steam|playstation|xbox|nintendo|teatro|\bshow\b|parque|cinemark|kinoplex|eventim|ticketmaster|\bclube\b/],
    ['Mercado', /superm|market(?!place)|mercado(?! ?livre)|carrefour|assai|atacad|pao de acucar|hortifruti|sacolao|sonda|savegnago|sams club|tempero|armazem|emporio/],
    ['Restaurantes', /ifood|ifd\*|rappi|restaur|lanchon|lanche|pizz|burger|burguer|franks|mc ?donald|padaria|panificadora|paes e|doces?\b|doceria|cafeteria|\bcafe\b|caffe|pracafe|starbucks|churrasc|sushi|acai|sorvet|outback|subway|habib|giraffas|madero|spoleto|boteco|\bbar\b|gourmet|gastronom|hot ?dog|galeto|caldo|patties|porco|bistro|grill|quitanda gastron/],
    ['Transporte', /\buber\b|cabify|\b99 ?(pop|taxi|tecnologia|app)|99app|\bposto\b|shell|ipiranga|br mania|combust|estaciona|sem parar|conectcar|veloe|metro|cptm|bilhete unico|pedagio|rodoanel|marginal|sptrans|autopass|indigo/],
    ['Saúde', /farmacia|drogaria|drogasil|droga raia|pacheco|panvel|hospital|clinica|laborat|unimed|odonto|amil|fleury|dasa|sulamerica saude|pague menos/],
    ['Assinaturas', /netflix|spotify|amazon ?prime|prime video|disney|hbo|\bmax\b|youtube|apple\.com|icloud|google (one|storage)|globoplay|deezer|paramount|adobe|microsoft ?365|chatgpt|openai|anthropic|claude\.ai|dropbox|crunchyroll|telecine|premiere/],
    ['Contas', /enel|sabesp|eletropaulo|cpfl|comgas|\bvivo\b|\bclaro\b|\btim\b|\boi\b|internet|energia|\bagua\b|\bgas\b|seguro|telefon|light s|copel|cemig|sanepar|neoenergia/],
    ['Educação', /escola|faculdade|curso|udemy|alura|colegio|mensalidade|livraria|saraiva|universid/],
    ['Viagem', /latam|gol linhas|azul linhas|airbnb|booking|hotel|decolar|123milhas|\bcvc\b|pousada|hostel/],
    ['Compras', /amazon|mercado ?livre|magalu|magazine luiza|americanas|shopee|aliexpress|shein|renner|c ?& ?a\b|zara|riachuelo|kabum|casas bahia|ponto frio|fast shop|leroy|tok ?& ?stok|decathlon|netshoes|centauro|havaianas|natura|boticario|sephora|whaleco|temu|marketplace|ferragens|multimarcas/]
  ];

  /* "Pix enviado para MARIA DA SILVA": pessoa física tem nome, sem sufixo de empresa. */
  function pixPessoa(desc) {
    var m = stripAcc(desc).toUpperCase().match(/^PIX ENVIADO PARA (.+)$/);
    if (!m) return false;
    var n = m[1].trim();
    if (/\b(LTDA|S ?\/ ?A|SA|ME|EPP|EIRELI|MEI|INTERNACIONAL|PAGAMENTOS?|BRASIL|BR|SERVICOS|COMERCIO|MARKETPLACE|TECNOLOGIA|SOLUCOES|INSTITUICAO|CLUBE|INTERMEDIACAO|PROGRAMACAO|PAY|BANK|PIX|POSTO)\b/.test(n)) return false;
    return n.split(/\s+/).length >= 2;
  }

  var IGNORAR = /pagamento (de )?fatura|pgto fatura|pag(to)? fatura|fatura (do )?cart|pagamento recebido|pagto cartao|saldo (anterior|final|do dia|disponivel)|aplicacao|resgate|rendimento|transferencia entre contas|mesma titularidade|investimento|cdb|rdb|poupanca automatica/;

  /* nome = como o usuário aparece no banco; transferências para ele mesmo não são gasto. */
  function ignoravel(desc, nome) {
    var d = stripAcc(desc);
    if (IGNORAR.test(d.toLowerCase())) return true;
    if (nome) {
      var ws = stripAcc(nome).toUpperCase().split(/\s+/).filter(function (w) { return w.length > 2 && !/^(DOS|DAS|DE|DA|DO)$/.test(w); }), du = d.toUpperCase();
      if (ws.length >= 2 && ws.every(function (w) { return du.indexOf(w) >= 0; }) && /^PIX (ENVIADO|RECEBIDO)|TRANSF/.test(du)) return true;
    }
    return false;
  }

  /* Devolução recebida + gasto de mesmo valor e mesmo destino = estorno; os dois se anulam. */
  function parearEstornos(rows) {
    rows.forEach(function (r) {
      if (r.kind !== 'receita' || !/\b(devol|estorno|reembolso)/i.test(stripAcc(r.desc))) return;
      var k = normKey(r.desc.replace(/(devolu\w*|devol\w*|estorno|reembolso)( recebid[ao])?( pix)?( de)?/i, ''));
      if (!k) return;
      for (var i = 0; i < rows.length; i++) {
        var g = rows[i];
        if (g.kind === 'gasto' && !g.estorno && Math.round(g.v * 100) === Math.round(r.v * 100) && normKey(g.desc) === k) { g.estorno = r.estorno = true; break; }
      }
    });
  }

  /* Categoriza: 1) regra aprendida, 2) histórico do próprio usuário, 3) palavras-chave. */
  function makeCategorizer(items) {
    var rules = {}, hist = {};
    Object.keys(items).forEach(function (id) {
      var it = items[id]; if (!it) return;
      if (it.t === 'rule') rules[it.key] = it.cat;
      else if (it.t === 'tx' && it.desc) {
        var k = normKey(it.desc); if (!k) return;
        hist[k] = hist[k] || {}; hist[k][it.cat] = (hist[k][it.cat] || 0) + 1;
      }
    });
    return function (desc, kind) {
      var list = kind === 'receita' ? CATS_R : CATS_G, k = normKey(desc);
      if (k && rules[k] && list.indexOf(rules[k]) >= 0) return rules[k];
      if (k && hist[k]) {
        var best = null;
        Object.keys(hist[k]).forEach(function (c) { if (list.indexOf(c) >= 0 && (!best || hist[k][c] > hist[k][best])) best = c; });
        if (best) return best;
      }
      var s = stripAcc(desc).toLowerCase();
      if (kind === 'receita') return /salario|folha|proventos|pagto sal|vencimento|recebimento de ted/.test(s) || /\b\d{14}\b/.test(s) ? 'Salário' : 'Outros';
      for (var i = 0; i < REGRAS.length; i++) if (REGRAS[i][1].test(s)) return REGRAS[i][0];
      return pixPessoa(desc) ? 'Transferências' : 'Outros';
    };
  }

  function pgtoDe(desc) {
    var s = stripAcc(desc).toLowerCase();
    return /pix/.test(s) ? 'Pix' : /boleto/.test(s) ? 'Boleto' : /credito|fatura/.test(s) ? 'Cartão de crédito' : 'Débito';
  }

  /* Marca o que já existe nos lançamentos: mesmo código do banco (certo) ou mesma data e valor (possível). */
  function marcarDuplicados(rows, items) {
    var refs = {}, chaves = {};
    Object.keys(items).forEach(function (id) {
      var it = items[id]; if (!it || it.t !== 'tx') return;
      if (it.ref) refs[it.ref] = 1;
      chaves[it.data + '|' + Math.round(it.valor * 100) + '|' + it.kind] = 1;
    });
    rows.forEach(function (r) {
      r.dup = r.ref && refs[r.ref] ? 'ref' : chaves[r.data + '|' + Math.round(r.v * 100) + '|' + r.kind] ? 'val' : '';
    });
  }

  /* ---------- Série mensal e preenchimento inteligente ---------- */
  function serieMensal(items, ymEnd, n, cat) {
    var out = [];
    for (var k = n - 1; k >= 0; k--) {
      var ym = addYm(ymEnd, -k), sm = summarize(entriesForMonth(items, ym));
      var desp = cat ? (sm.byCat[cat] || 0) : sm.despesas;
      out.push({ ym: ym, receitas: cat ? 0 : sm.receitas, despesas: desp, saldo: cat ? 0 : sm.receitas - sm.despesas });
    }
    return out;
  }

  /* "12,50 + 30" -> 42,5 (soma de várias parcelas de uma conta). */
  function parseMoneyExpr(s) {
    s = String(s == null ? '' : s);
    if (s.indexOf('+') < 0) return parseMoney(s);
    var parts = s.split('+'), tot = 0;
    for (var i = 0; i < parts.length; i++) { var v = parseMoney(parts[i]); if (!(v > 0)) return NaN; tot += v; }
    return Math.round(tot * 100) / 100;
  }

  /* "TV 3x", "geladeira em 10 vezes" -> número de parcelas (0 se não houver). */
  function parcelasDoTexto(desc) {
    var m = String(desc || '').match(/(\d{1,2})\s*(?:x|vezes|parcelas)\b/i), n = m ? parseInt(m[1], 10) : 0;
    return n >= 2 && n <= 72 ? n : 0;
  }

  function topKey(o) { var b = null; Object.keys(o).forEach(function (k) { if (!b || o[k] > o[b]) b = k; }); return b; }

  /* Agrupa os lançamentos já feitos pelo "mesmo estabelecimento". */
  function grupos(items, kind) {
    var g = {};
    Object.keys(items).forEach(function (id) {
      var it = items[id];
      if (!it || it.t !== 'tx' || !it.desc || (kind && it.kind !== kind)) return;
      var k = normKey(it.desc) || stripAcc(it.desc).toLowerCase().trim(), ym = it.data.slice(0, 7);
      var x = g[k] || (g[k] = { key: k, kind: it.kind, n: 0, cats: {}, pgtos: {}, last: null, meses: {} });
      x.n++; x.cats[it.cat] = (x.cats[it.cat] || 0) + 1;
      if (it.pgto) x.pgtos[it.pgto] = (x.pgtos[it.pgto] || 0) + 1;
      (x.meses[ym] = x.meses[ym] || []).push(it);
      if (!x.last || it.data > x.last.data) x.last = it;
    });
    return g;
  }

  /* Sugestões enquanto o usuário digita (ou as mais frequentes, se o texto estiver vazio). */
  function sugestoes(items, texto, kind, limit) {
    var g = grupos(items, kind), q = stripAcc(texto || '').toLowerCase().trim(), qk = normKey(texto || ''), list = [], recente = addMonths(todayStr(), -2);
    Object.keys(g).forEach(function (k) {
      var x = g[k], d = stripAcc(x.last.desc).toLowerCase();
      if (q && d.indexOf(q) < 0 && !(qk && k.indexOf(qk) >= 0)) return;
      var score = x.n * 2 + (x.last.data >= recente ? 3 : 0) + (qk && k === qk ? 100 : 0) + (q && d.indexOf(q) === 0 ? 10 : 0);
      list.push({ key: k, desc: x.last.desc, kind: x.kind, cat: topKey(x.cats), pgto: topKey(x.pgtos) || '', valor: x.last.valor, ultimo: x.last.data, vezes: x.n, score: score });
    });
    list.sort(function (a, b) { return b.score - a.score; });
    return list.slice(0, limit || 5);
  }

  /* Detecta conta que se repete mês a mês e ainda não é "fixa". */
  function recorrencia(items, desc, kind) {
    var k = normKey(desc); if (!k) return null;
    var x = grupos(items, kind)[k]; if (!x) return null;
    var meses = Object.keys(x.meses).sort(); if (meses.length < 3) return null;
    var a = meses[meses.length - 3], b = meses[meses.length - 2], c = meses[meses.length - 1];
    if (addYm(a, 1) !== b || addYm(b, 1) !== c || c < addYm(todayStr().slice(0, 7), -1)) return null;
    var tem = Object.keys(items).some(function (id) { var it = items[id]; return it && it.t === 'fixo' && normKey(it.desc) === k; });
    if (tem) return null;
    return { meses: meses.length, valor: x.last.valor, dia: parseInt(x.last.data.slice(8), 10) };
  }

  /* Forma de pagamento mais usada, para pré-selecionar no formulário. */
  function pgtoMaisUsado(items) {
    var c = {};
    Object.keys(items).forEach(function (id) { var it = items[id]; if (it && it.t === 'tx' && it.pgto) c[it.pgto] = (c[it.pgto] || 0) + 1; });
    return topKey(c);
  }

  var api = {
    CATS_G: CATS_G, CATS_R: CATS_R, PGTOS: PGTOS, MESES: MESES,
    pad: pad, todayStr: todayStr, addMonths: addMonths, addYm: addYm, ymLabel: ymLabel, ymShort: ymShort,
    daysInYm: daysInYm, fmtDate: fmtDate, parseMoney: parseMoney, parcelas: parcelas, parcStatus: parcStatus,
    entriesForMonth: entriesForMonth, summarize: summarize, projecaoParcelas: projecaoParcelas,
    orcamentos: orcamentos, brl: brl, pct: pct, insights: insights,
    parseDate: parseDate, parseAmount: parseAmount, parseStatement: parseStatement, normKey: normKey, makeCategorizer: makeCategorizer,
    serieMensal: serieMensal, parseMoneyExpr: parseMoneyExpr, parcelasDoTexto: parcelasDoTexto, sugestoes: sugestoes, recorrencia: recorrencia, pgtoMaisUsado: pgtoMaisUsado,
    ignoravel: ignoravel, parearEstornos: parearEstornos, pgtoDe: pgtoDe, marcarDuplicados: marcarDuplicados
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
