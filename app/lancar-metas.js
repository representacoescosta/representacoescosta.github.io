/* Sistema RC — Lançar metas (20/11/2026, v1).
   O banco na nuvem é a fonte das metas (decisão do Eric, 20/11). Três jeitos de lançar:
   1. copiar o mês anterior (api-relatorios "metas-copiar"; pede confirmação se o mês já tem metas);
   2. importar o Excel no modelo de hoje — aba com as colunas Vendedor | CNPJ | Código | Caixas (ex.: Metas_Banco_Claude) —
      lido aqui no navegador (só as linhas vão para a API; o arquivo não sai do aparelho) e gravado em modo "substituir";
   3. ajustar cliente a cliente (modo "ajustar"; caixas 0 apaga a linha).
   Segurança: só o gestor grava (meta.aprovar, conferido no servidor); a tela só mostra texto; arquivo até 15 MB e 4.000 linhas;
   o servidor confere de novo cliente, produto, caixas e vendedor. */
(function () {
  "use strict";
  var BASE = "https://fufwenjnnsvxdgnenpch.supabase.co/functions/v1/";
  var CHAVE_SESSAO = "rc_sessao";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var MAX_ARQ = 15 * 1024 * 1024, MAX_LINHAS = 4000;
  var palco = document.getElementById("palco");
  var estado = { reps: [], rep: null, comp: proximoMes(0) };

  function el(tag, props) {
    var e = document.createElement(tag), p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "text") e.textContent = v;
      else if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) e.append(typeof x === "string" ? document.createTextNode(x) : x); });
      else e.append(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return e;
  }
  function token() { try { return sessionStorage.getItem(CHAVE_SESSAO); } catch (e) { return null; } }
  function n0(v) { return v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }); }
  function msg(m, t, tipo) { m.textContent = t || ""; m.className = "msg" + (tipo ? " " + tipo : ""); }
  function proximoMes(desloc) { var d = new Date(); var x = new Date(d.getFullYear(), d.getMonth() + 1 + desloc, 1); return x.getFullYear() + "-" + ("0" + (x.getMonth() + 1)).slice(-2); }
  function nomeMes(v) { var p = v.split("-"); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); }
  function anterior(v) { var p = v.split("-"); var x = new Date(+p[0], +p[1] - 2, 1); return x.getFullYear() + "-" + ("0" + (x.getMonth() + 1)).slice(-2); }
  function meses() { var r = []; for (var i = 1; i >= -4; i--) r.push(proximoMes(i)); return r; }

  function chamar(api, acao, dados) {
    var t = token();
    if (!t) return Promise.resolve({ ok: false, _http: 401 });
    return fetch(BASE + api + "/" + acao, {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, dados || {}, { token: t }))
    }).then(function (r) {
      return r.json().then(function (j) { j = j && typeof j === "object" && !Array.isArray(j) ? j : {}; j._http = r.status; return j; },
        function () { return { ok: false, _http: r.status, erro: "Resposta inválida. Tente de novo." }; });
    }, function () { return { ok: false, _http: 0, erro: "Sem conexão. Confira a internet e tente de novo." }; });
  }
  function semSessao() {
    palco.replaceChildren(el("section", { class: "cartao" }, el("h1", { text: "Sessão encerrada" }),
      el("p", { text: "Entre de novo para continuar." }), el("div", null, el("a", { href: "entrar.html" }, el("button", { type: "button", text: "Entrar" })))));
  }

  /* ---------- leitura do Excel (.xlsx = zip com XML), sem biblioteca externa ---------- */
  function lerZip(buf) {
    var b = new Uint8Array(buf), dv = new DataView(buf), e = b.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("O arquivo não é um Excel (.xlsx) válido.");
    var n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true), mapa = {};
    for (var i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("O arquivo não é um Excel (.xlsx) válido.");
      var met = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true),
        xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      mapa[new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl))] = { met: met, cs: cs, off: off };
      p += 46 + nl + xl + cl;
    }
    function texto(nome) {
      var x = mapa[nome]; if (!x) return Promise.resolve(null);
      var ini = x.off + 30 + dv.getUint16(x.off + 26, true) + dv.getUint16(x.off + 28, true), dados = b.slice(ini, ini + x.cs);
      if (x.met === 0) return Promise.resolve(new TextDecoder().decode(dados));
      if (x.met !== 8 || typeof DecompressionStream === "undefined") return Promise.reject(new Error("Este navegador não consegue abrir o Excel. Use o Chrome atualizado."));
      return new Response(new Blob([dados]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
    }
    return texto;
  }
  function ent(s) { return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); }).replace(/&amp;/g, "&"); }
  function atributo(tag, nome) { var m = new RegExp("\\b" + nome + "=\"([^\"]*)\"").exec(tag); return m ? ent(m[1]) : ""; }
  function lerExcel(buf) {
    var texto = lerZip(buf);
    return Promise.all([texto("xl/workbook.xml"), texto("xl/_rels/workbook.xml.rels"), texto("xl/sharedStrings.xml")]).then(function (r) {
      if (!r[0] || !r[1]) throw new Error("O arquivo não é um Excel (.xlsx) válido.");
      var rels = {}; (r[1].match(/<Relationship\b[^>]*>/g) || []).forEach(function (t) { rels[atributo(t, "Id")] = atributo(t, "Target"); });
      var abas = (r[0].match(/<sheet\b[^>]*>/g) || []).map(function (t) {
        var alvo = rels[atributo(t, "r:id")] || ""; alvo = alvo.replace(/^\/?xl\//, "");
        return { nome: atributo(t, "name"), arq: "xl/" + alvo };
      });
      var ss = (r[2] || "").match(/<si>[\s\S]*?<\/si>/g) || [];
      ss = ss.map(function (si) { return ent((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(function (t) { return t.replace(/<[^>]+>/g, ""); }).join("")); });
      // procura a aba com o cabeçalho Vendedor | CNPJ | Código | Caixas (a Metas_Banco_Claude primeiro)
      abas.sort(function (a, b) { return (b.nome === "Metas_Banco_Claude") - (a.nome === "Metas_Banco_Claude"); });
      return abas.reduce(function (prom, aba) {
        return prom.then(function (achou) {
          if (achou) return achou;
          return texto(aba.arq).then(function (xml) { return xml ? linhasDaAba(xml, ss, aba.nome) : null; });
        });
      }, Promise.resolve(null)).then(function (achou) {
        if (!achou) throw new Error("Não achei uma aba com as colunas Vendedor, CNPJ, Código e Caixas.");
        return achou;
      });
    });
  }
  function colIdx(ref) { var l = /^[A-Z]+/.exec(ref || "A")[0], n = 0; for (var i = 0; i < l.length; i++) n = n * 26 + l.charCodeAt(i) - 64; return n - 1; }
  function linhasDaAba(xml, ss, nome) {
    var linhas = [], cab = null, ix = null, rows = xml.match(/<row\b[\s\S]*?<\/row>/g) || [];
    for (var i = 0; i < rows.length; i++) {
      var o = [];
      (rows[i].match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach(function (c) {
        var tag = /<c\b[^>]*>/.exec(c)[0], t = atributo(tag, "t"), v = /<v>([\s\S]*?)<\/v>/.exec(c), is = /<is>([\s\S]*?)<\/is>/.exec(c);
        var val = t === "s" ? (ss[+(v ? v[1] : -1)] || "") : t === "inlineStr" ? ent((is ? is[1] : "").replace(/<[^>]+>/g, "")) : v ? ent(v[1]) : "";
        o[colIdx(atributo(tag, "r"))] = String(val).trim();
      });
      if (!ix) {
        var norm = o.map(function (x) { return (x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); });
        var iv = norm.indexOf("vendedor"), ic = norm.indexOf("cnpj"), ip = norm.indexOf("codigo"), ix4 = norm.indexOf("caixas");
        if (ic >= 0 && ip >= 0 && ix4 >= 0) { ix = { v: iv, c: ic, p: ip, x: ix4 }; cab = i; }
        if (i > 20 && !ix) return null;
        continue;
      }
      var cli = o[ix.c] || "", prod = o[ix.p] || "", cx = Number(String(o[ix.x] || "").replace(",", "."));
      if (!cli && !prod) continue;
      if (!(cx > 0)) continue;
      linhas.push({ vendedor: ix.v >= 0 ? (o[ix.v] || "").slice(0, 60) : "", cliente: cli.slice(0, 40), produto: prod.slice(0, 20), caixas: Math.round(cx * 1000) / 1000 });
      if (linhas.length > MAX_LINHAS) throw new Error("O arquivo tem mais de " + MAX_LINHAS + " linhas de meta.");
    }
    return ix ? { aba: nome, linhas: linhas } : null;
  }

  /* ---------- telas ---------- */
  function iniciar() {
    palco.replaceChildren(el("p", { class: "dica", text: "Carregando…" }));
    chamar("api-fichas", "opcoes", {}).then(function (r) {
      if (r._http === 401) return semSessao();
      var reps = r.ok && r.opcoes && Array.isArray(r.opcoes.representadas) ? r.opcoes.representadas.filter(function (x) { return x && UUID.test(x.id || ""); }) : [];
      if (!reps.length) return palco.replaceChildren(el("section", { class: "cartao" }, el("p", { class: "msg erro", text: r.erro || "Não foi possível carregar as representadas." })));
      estado.reps = reps;
      estado.rep = (reps.filter(function (x) { return x.nome === "GODAM"; })[0] || reps[0]).id;
      desenhar();
    });
  }

  function resultado(caixa, r) {
    caixa.replaceChildren();
    if (!r) return;
    if (!r.ok) { caixa.append(el("p", { class: "msg erro", text: r.erro || "Não foi possível gravar." })); return; }
    var t = r.total || {};
    caixa.append(el("p", { class: "msg ok", text: "Gravado: " + n0(r.gravados) + " linha(s)" + (r.apagados ? ", " + n0(r.apagados) + " apagada(s)" : "") +
      (r.ignorados ? ", " + n0(r.ignorados) + " ignorada(s)" : "") + ". Mês agora: " + n0(t.linhas) + " linhas, " + n0(t.caixas) + " caixas, " + n0(t.kg) + " kg." }));
    var av = Array.isArray(r.avisos) ? r.avisos : [];
    if (av.length) {
      var tb = el("tbody");
      av.slice(0, 300).forEach(function (a) {
        tb.append(el("tr", null, el("td", { class: "num", text: String(a.linha || "") }), el("td", { text: String(a.aviso || "") }),
          el("td", { text: String(a.cliente || "") }), el("td", { text: String(a.produto || "") }), el("td", { text: String(a.vendedor || "") })));
      });
      caixa.append(el("p", { class: "dica", text: av.length + " aviso(s): confira as linhas abaixo." }),
        el("div", { class: "rolar" }, el("table", null, el("thead", null, el("tr", null, el("th", { text: "Linha" }), el("th", { text: "Aviso" }),
          el("th", { text: "Cliente" }), el("th", { text: "Produto" }), el("th", { text: "Vendedor" }))), tb)));
    }
  }

  function desenhar() {
    var selRep = el("select", { "aria-label": "Representada", onchange: function () { estado.rep = selRep.value; } });
    estado.reps.forEach(function (x) { selRep.append(el("option", { value: x.id, text: String(x.nome || ""), selected: x.id === estado.rep })); });
    var selMes = el("select", { "aria-label": "Mês da meta", onchange: function () { estado.comp = selMes.value; desenhar(); } });
    meses().forEach(function (m) { selMes.append(el("option", { value: m, text: nomeMes(m), selected: m === estado.comp })); });

    // 1. copiar
    var selDe = el("select", { "aria-label": "Copiar de" });
    meses().concat([proximoMes(-5), proximoMes(-6)]).forEach(function (m) { if (m !== estado.comp) selDe.append(el("option", { value: m, text: nomeMes(m), selected: m === anterior(estado.comp) })); });
    var resCop = el("div"), btCop = el("button", { type: "button", text: "Copiar metas" });
    function copiar(subs) {
      btCop.disabled = true; resCop.replaceChildren(el("p", { class: "dica", text: "Copiando…" }));
      chamar("api-relatorios", "metas-copiar", { origem: selDe.value, destino: estado.comp, representada_id: selRep.value, substituir: subs }).then(function (r) {
        btCop.disabled = false;
        if (r._http === 401) return semSessao();
        if (r.codigo === "ja_existe") {
          return resCop.replaceChildren(el("p", { class: "msg erro", text: nomeMes(estado.comp) + " já tem " + n0(r.linhas_no_destino) + " linhas de meta. Copiar substitui todas." }),
            el("div", { class: "filtros" }, el("button", { type: "button", text: "Substituir as metas de " + nomeMes(estado.comp), onclick: function () { copiar(true); } }),
              el("button", { type: "button", class: "sec", text: "Cancelar", onclick: function () { resCop.replaceChildren(); } })));
        }
        resultado(resCop, r);
      });
    }
    btCop.addEventListener("click", function () { copiar(false); });

    // 2. importar
    var arq = el("input", { type: "file", accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "aria-label": "Arquivo Excel" });
    var resImp = el("div"), previa = el("div"), lido = null;
    var btImp = el("button", { type: "button", text: "Importar e substituir as metas do mês", disabled: true });
    arq.addEventListener("change", function () {
      lido = null; btImp.disabled = true; resImp.replaceChildren(); previa.replaceChildren();
      var f = arq.files && arq.files[0]; if (!f) return;
      if (f.size > MAX_ARQ) return previa.replaceChildren(el("p", { class: "msg erro", text: "Arquivo grande demais (até 15 MB)." }));
      previa.replaceChildren(el("p", { class: "dica", text: "Lendo " + f.name + "…" }));
      f.arrayBuffer().then(lerExcel).then(function (x) {
        if (!x.linhas.length) return previa.replaceChildren(el("p", { class: "msg erro", text: "A aba " + x.aba + " não tem linhas com caixas." }));
        lido = x;
        var porVend = {}, cx = 0;
        x.linhas.forEach(function (l) { porVend[l.vendedor || "(sem vendedor)"] = (porVend[l.vendedor || "(sem vendedor)"] || 0) + l.caixas; cx += l.caixas; });
        var tb = el("tbody");
        Object.keys(porVend).sort().forEach(function (v) { tb.append(el("tr", null, el("td", { text: v }), el("td", { class: "num", text: n0(porVend[v]) }))); });
        previa.replaceChildren(el("p", null, el("b", { text: f.name + " · aba " + x.aba + ": " + n0(x.linhas.length) + " linhas, " + n0(cx) + " caixas." })),
          el("div", { class: "rolar" }, el("table", null, el("thead", null, el("tr", null, el("th", { text: "Vendedor" }), el("th", { class: "num", text: "Caixas" }))), tb)),
          el("p", { class: "dica", text: "Ao importar, as metas de " + nomeMes(estado.comp) + " desta representada são substituídas pelas do arquivo." }));
        btImp.disabled = false;
      }).catch(function (e) { previa.replaceChildren(el("p", { class: "msg erro", text: e && e.message ? e.message : "Não foi possível ler o arquivo." })); });
    });
    btImp.addEventListener("click", function () {
      if (!lido) return;
      btImp.disabled = true; resImp.replaceChildren(el("p", { class: "dica", text: "Gravando " + n0(lido.linhas.length) + " linhas…" }));
      chamar("api-relatorios", "metas-salvar", { competencia: estado.comp, representada_id: selRep.value, modo: "substituir", itens: lido.linhas }).then(function (r) {
        btImp.disabled = false;
        if (r._http === 401) return semSessao();
        resultado(resImp, r);
      });
    });

    // 3. ajustar
    var eCli = el("input", { "aria-label": "Cliente (código RC ou CNPJ)", placeholder: "RC00279 ou CNPJ", maxlength: "40" });
    var eProd = el("input", { "aria-label": "Produto (código)", placeholder: "108", maxlength: "20", inputmode: "numeric" });
    var eCx = el("input", { "aria-label": "Caixas", placeholder: "0", inputmode: "decimal", maxlength: "10" });
    var eVen = el("input", { "aria-label": "Vendedor (opcional)", placeholder: "da carteira", maxlength: "60" });
    var resAj = el("div"), mAj = el("p", { class: "msg" });
    var btAj = el("button", { type: "button", text: "Gravar ajuste", onclick: function () {
      var cx = Number(String(eCx.value).trim().replace(",", "."));
      if (!eCli.value.trim() || !eProd.value.trim()) return msg(mAj, "Informe o cliente e o produto.", "erro");
      if (!(cx >= 0 && cx <= 100000) || String(eCx.value).trim() === "") return msg(mAj, "Caixas: um número de 0 a 100.000 (0 apaga a meta).", "erro");
      msg(mAj, ""); btAj.disabled = true;
      var it = { cliente: eCli.value.trim(), produto: eProd.value.trim(), caixas: Math.round(cx * 1000) / 1000 };
      if (eVen.value.trim()) it.vendedor = eVen.value.trim();
      chamar("api-relatorios", "metas-salvar", { competencia: estado.comp, representada_id: selRep.value, modo: "ajustar", itens: [it] }).then(function (r) {
        btAj.disabled = false;
        if (r._http === 401) return semSessao();
        resultado(resAj, r);
      });
    } });

    palco.replaceChildren(
      el("section", { class: "cartao" }, el("h1", { text: "Lançar metas" }),
        el("div", { class: "filtros" }, el("label", null, "Representada", selRep), el("label", null, "Mês da meta", selMes)),
        el("p", { class: "dica", text: "As metas ficam no sistema novo (fonte oficial). Só o gestor lança. Leite e produto inativo ficam fora; o kg é calculado pelo peso da caixa do cadastro." })),
      el("section", { class: "cartao" }, el("h1", { text: "1. Copiar de outro mês" }),
        el("div", { class: "filtros" }, el("label", null, "Copiar de", selDe), btCop),
        el("p", { class: "dica", text: "Copia as caixas por cliente e produto. O vendedor vem da carteira de hoje." }), resCop),
      el("section", { class: "cartao" }, el("h1", { text: "2. Importar o Excel" }),
        el("p", { class: "dica", text: "Use o Excel de metas de sempre: a aba com as colunas Vendedor, CNPJ, Código e Caixas (Metas_Banco_Claude). O arquivo é lido aqui; só as linhas vão para o sistema." }),
        el("div", { class: "filtros" }, arq), previa, el("div", { class: "filtros" }, btImp), resImp),
      el("section", { class: "cartao" }, el("h1", { text: "3. Ajustar cliente a cliente" }),
        el("div", { class: "filtros" }, el("label", null, "Cliente", eCli), el("label", null, "Produto", eProd), el("label", null, "Caixas", eCx), el("label", null, "Vendedor", eVen), btAj),
        mAj, el("p", { class: "dica", text: "Caixas 0 apaga a meta desse cliente e produto. Vendedor em branco: o vendedor da loja na carteira." }), resAj));
  }

  if (!token()) semSessao(); else iniciar();
})();
