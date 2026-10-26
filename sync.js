/* Nuvem: guarda os dados no banco Convex, SEMPRE criptografados no aparelho (AES-GCM).
   A chave vem da senha do app (PBKDF2). O servidor só enxerga texto cifrado. */
(function () {
  var CX = 'https://dynamic-malamute-684.eu-west-1.convex.cloud';
  var COL = 'fin_v1';
  var KEYLS = 'fin:k', CACHELS = 'fin:cache';
  var key = null, meta = null;
  var writeAt = 0, inflight = 0, lastSig = null, timer = null, onData = null, onStatus = null;

  function b64(buf) { var s = ''; new Uint8Array(buf).forEach(function (x) { s += String.fromCharCode(x); }); return btoa(s); }
  function unb64(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

  function call(kind, path, args) {
    return fetch(CX + '/api/' + kind, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path, args: args, format: 'json' })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.status !== 'success') throw new Error(j.errorMessage || 'erro');
      return j.value;
    });
  }

  function derive(pass, saltB64) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: unb64(saltB64), iterations: 200000, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    });
  }

  function enc(obj) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj))).then(function (ct) {
      return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) });
    });
  }

  function dec(str) {
    var o = JSON.parse(str);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct)).then(function (pt) {
      return JSON.parse(new TextDecoder().decode(pt));
    });
  }

  function getMeta() {
    return call('query', 'docs:get', { col: COL, id: 'meta' }).then(function (row) {
      meta = row ? JSON.parse(row.data) : null;
      return meta;
    });
  }

  /* Primeiro acesso: cria o salt e um "verificador" para validar a senha nos outros aparelhos. */
  function setup(pass) {
    var salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    return derive(pass, salt).then(function (k) {
      key = k;
      return enc({ ok: 1 });
    }).then(function (check) {
      meta = { salt: salt, check: check };
      return call('mutation', 'docs:set', { col: COL, id: 'meta', data: JSON.stringify(meta) });
    }).then(remember);
  }

  function unlock(pass) {
    return derive(pass, meta.salt).then(function (k) {
      key = k;
      return dec(meta.check);
    }).then(remember, function () { key = null; throw new Error('senha'); });
  }

  /* A chave NUNCA é guardada no aparelho: a senha é pedida a cada acesso. */
  function remember() {
    try { localStorage.removeItem(KEYLS); } catch (e) {}
    return Promise.resolve();
  }

  function tryRemembered() {
    try { localStorage.removeItem(KEYLS); } catch (e) {}
    return Promise.resolve(false);
  }

  function lock() {
    try { localStorage.removeItem(KEYLS); localStorage.removeItem(CACHELS); } catch (e) {}
    key = null;
    if (timer) clearInterval(timer);
  }

  /* Modo teste: sem nuvem, dados de exemplo guardados só neste aparelho. */
  var local = false, mem = null, LOCALLS = 'fin:local';
  function seed() {
    var C = window.Core, ym = C.todayStr().slice(0, 7), pv = C.addYm(ym, -1);
    return {
      d1: { t: 'tx', kind: 'receita', desc: 'Salário (exemplo)', valor: 5200, cat: 'Salário', data: ym + '-05' },
      d2: { t: 'tx', kind: 'gasto', desc: 'Mercado (exemplo)', valor: 412.8, cat: 'Mercado', data: ym + '-03', pgto: 'Débito' },
      d3: { t: 'tx', kind: 'gasto', desc: 'Restaurante (exemplo)', valor: 96.5, cat: 'Restaurantes', data: ym + '-04', pgto: 'Pix' },
      d4: { t: 'tx', kind: 'gasto', desc: 'Uber (exemplo)', valor: 28.9, cat: 'Transporte', data: ym + '-02', pgto: 'Cartão de crédito' },
      d5: { t: 'tx', kind: 'receita', desc: 'Salário (exemplo)', valor: 5200, cat: 'Salário', data: pv + '-05' },
      d6: { t: 'tx', kind: 'gasto', desc: 'Mercado (exemplo)', valor: 318.4, cat: 'Mercado', data: pv + '-08', pgto: 'Débito' },
      d7: { t: 'tx', kind: 'gasto', desc: 'Restaurante (exemplo)', valor: 245, cat: 'Restaurantes', data: pv + '-12', pgto: 'Pix' },
      p1: { t: 'parc', desc: 'Notebook (exemplo)', total: 4800, n: 12, primeira: C.addYm(ym, -3) + '-10', compra: C.addYm(ym, -4) + '-28', cat: 'Compras', pgto: 'Cartão de crédito' },
      p2: { t: 'parc', desc: 'Geladeira (exemplo)', total: 3600, n: 10, primeira: pv + '-15', compra: pv + '-02', cat: 'Moradia', pgto: 'Cartão de crédito' },
      p3: { t: 'parc', desc: 'Celular (exemplo)', total: 2400, n: 6, primeira: C.addYm(ym, -5) + '-05', compra: C.addYm(ym, -6) + '-20', cat: 'Compras', pgto: 'Cartão de crédito' },
      f1: { t: 'fixo', kind: 'gasto', desc: 'Aluguel (exemplo)', valor: 1600, cat: 'Moradia', dia: 5, inicio: C.addYm(ym, -6), fim: null, pgto: 'Boleto' },
      f2: { t: 'fixo', kind: 'gasto', desc: 'Streaming (exemplo)', valor: 55.9, cat: 'Assinaturas', dia: 12, inicio: C.addYm(ym, -6), fim: null, pgto: 'Cartão de crédito' },
      o1: { t: 'orc', cat: 'Mercado', limite: 450 },
      o2: { t: 'orc', cat: 'Restaurantes', limite: 300 }
    };
  }
  function lget() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(LOCALLS) || 'null'); } catch (e) {}
    if (!mem) mem = seed();
    return mem;
  }
  function lsave() { try { localStorage.setItem(LOCALLS, JSON.stringify(mem)); } catch (e) {} }
  function useLocal() { local = true; lget(); }
  function clearLocal() { mem = {}; lsave(); }

  function decryptRows(rows) {
    var items = {};
    return Promise.all(rows.filter(function (r) { return r.id !== 'meta'; }).map(function (r) {
      return dec(r.data).then(function (v) { items[r.id] = v; }, function () {});
    })).then(function () { return items; });
  }

  function pull(force) {
    if (local) { onData(JSON.parse(JSON.stringify(lget()))); onStatus && onStatus('ok'); return Promise.resolve(); }
    var t0 = Date.now();
    return call('query', 'docs:list', { col: COL }).then(function (rows) {
      if (writeAt > t0 || inflight > 0) return;
      var sig = rows.length + ':' + rows.map(function (r) { return r.id + r.data.length + r.data.slice(-12); }).join('|');
      if (!force && sig === lastSig) { onStatus && onStatus('ok'); return; }
      lastSig = sig;
      try { localStorage.setItem(CACHELS, JSON.stringify(rows)); } catch (e) {}
      return decryptRows(rows).then(function (items) { onData(items); onStatus && onStatus('ok'); });
    }).catch(function () { onStatus && onStatus('off'); });
  }

  function start(cbData, cbStatus) {
    onData = cbData; onStatus = cbStatus;
    if (local) { onData(JSON.parse(JSON.stringify(lget()))); onStatus('ok'); return; }
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHELS) || 'null'); } catch (e) {}
    var first = cached ? decryptRows(cached).then(onData) : Promise.resolve();
    first.then(function () { return pull(true); });
    timer = setInterval(function () { if (document.visibilityState === 'visible') pull(false); }, 6000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') pull(false); });
  }

  function set(id, obj) {
    if (local) { lget()[id] = obj; lsave(); return Promise.resolve(); }
    inflight++;
    return enc(obj).then(function (data) {
      return call('mutation', 'docs:set', { col: COL, id: id, data: data });
    }).then(function () { inflight--; writeAt = Date.now(); lastSig = null; }, function (e) { inflight--; throw e; });
  }

  function del(id) {
    if (local) { delete lget()[id]; lsave(); return Promise.resolve(); }
    inflight++;
    return call('mutation', 'docs:remove', { col: COL, id: id }).then(function () { inflight--; writeAt = Date.now(); lastSig = null; }, function (e) { inflight--; throw e; });
  }

  window.Cloud = { getMeta: getMeta, setup: setup, unlock: unlock, tryRemembered: tryRemembered, lock: lock, useLocal: useLocal, clearLocal: clearLocal, isLocal: function () { return local; }, start: start, set: set, del: del, pull: pull };
})();
