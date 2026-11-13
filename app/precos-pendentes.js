/* Sistema RC — Preços pendentes (13/11/2026, v1).
   O gestor vê os pedidos com produto sem preço na tabela (status "aguardando preço"), digita o preço e libera o pedido.
   API: api-pedidos "aguardando-preco" (fila) e "aprovar-precos" (grava, com conferência da versão do pedido).
   Segurança: quem pode aprovar é decidido no servidor (permissão preco.ajustar); a tela só mostra o que a API devolve,
   sempre como texto; ids só uuid; preço conferido aqui (> 0, até 99.999) e de novo no servidor. */
(function () {
  "use strict";
  var API = "https://fufwenjnnsvxdgnenpch.supabase.co/functions/v1/api-pedidos/";
  var CHAVE_SESSAO = "rc_sessao";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var palco = document.getElementById("palco");

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
  function txt(v) { return v === null || v === undefined ? "" : typeof v === "object" ? String(v.texto || "") : String(v); }
  function msg(m, texto, tipo) { m.textContent = texto || ""; m.className = "msg" + (tipo ? " " + tipo : ""); }
  function token() { try { return sessionStorage.getItem(CHAVE_SESSAO); } catch (e) { return null; } }
  function numero(v) { v = String(v === null || v === undefined ? "" : v).trim().replace(/\s|R\$/g, ""); if (v.indexOf(",") >= 0) v = v.replace(/\./g, "").replace(",", "."); var n = Number(v); return v !== "" && isFinite(n) ? n : null; }
  function dec(v, c) { return v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }); }
  function moeda(v) { return v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

  function chamar(acao, dados) {
    var t = token();
    if (!t) return Promise.resolve({ ok: false, _http: 401 });
    return fetch(API + acao, {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, dados || {}, { token: t }))
    }).then(function (r) {
      return r.json().then(function (j) { j = j && typeof j === "object" && !Array.isArray(j) ? j : {}; j._http = r.status; return j; },
        function () { return { ok: false, _http: r.status, erro: "Resposta inválida. Tente de novo." }; });
    }, function () { return { ok: false, _http: 0, erro: "Sem conexão. Confira a internet e tente de novo." }; });
  }
  function semSessao() {
    palco.replaceChildren(el("section", { class: "cartao" }, el("h1", { text: "Sessão encerrada" }),
      el("p", { text: "Entre de novo para continuar." }),
      el("div", { class: "acoes" }, el("a", { href: "entrar.html" }, el("button", { type: "button", text: "Entrar" })))));
  }

  function carregar(aviso) {
    palco.replaceChildren(el("p", { class: "dica", text: "Carregando os pedidos…" }));
    chamar("aguardando-preco", {}).then(function (r) {
      if (r._http === 401) return semSessao();
      if (r._http === 403) return palco.replaceChildren(el("section", { class: "cartao" }, el("h1", { text: "Só para gestor" }),
        el("p", { text: "Esta tela é de quem aprova preços (gestor ou escritório)." })));
      if (!r.ok || !Array.isArray(r.pedidos)) return palco.replaceChildren(el("section", { class: "cartao" }, el("h1", { text: "Não foi possível carregar" }),
        el("p", { class: "msg erro", text: r.erro || "Tente de novo em instantes." }),
        el("div", { class: "acoes" }, el("button", { type: "button", text: "Tentar de novo", onclick: function () { carregar(); } }))));
      var topo = el("section", { class: "cartao" },
        el("div", { class: "acoes", style: "justify-content:space-between;align-items:center" },
          el("h1", { text: "Preços pendentes" }), el("button", { type: "button", class: "sec", text: "Atualizar", onclick: function () { carregar(); } })),
        el("p", { class: "dica", text: r.pedidos.length ? r.pedidos.length + (r.pedidos.length === 1 ? " pedido aguardando" : " pedidos aguardando") + " o preço. O pedido só segue para a representada depois da aprovação." : "Nenhum pedido aguardando preço." }));
      if (aviso) topo.append(el("p", { class: "msg " + aviso[1], text: aviso[0] }));
      palco.replaceChildren(topo);
      r.pedidos.forEach(function (p) { palco.append(cartaoPedido(p)); });
    });
  }

  function cartaoPedido(p) {
    var pid = p && p.pedido && UUID.test(p.pedido.id || "") ? p.pedido.id : null;
    if (!pid || !Array.isArray(p.itens)) return el("span");
    var m = el("p", { class: "msg" }), campos = [];
    var corpo = el("div", { class: "lista" });
    p.itens.forEach(function (i) {
      if (!i || !UUID.test(i.item_id || "")) return;
      var un = i.tipo_peso === "PV" ? "kg" : "un";
      var ent = el("input", { class: "grande", inputmode: "decimal", autocomplete: "off", placeholder: "0,00", "aria-label": "Preço de " + txt(i.produto) });
      if (i.preco_sugerido !== null && i.preco_sugerido !== undefined) ent.value = dec(i.preco_sugerido, 2);
      campos.push({ id: i.item_id, ent: ent });
      corpo.append(el("div", { class: "item" },
        el("div", { class: "t" }, txt(i.produto), i.bonificado ? el("span", { class: "selo bon", text: "Bonificado" }) : null),
        el("div", { class: "v", text: String(i.caixas) + " cx" }),
        el("div", { class: "s", text: [i.codigo, i.tipo_peso, i.preco_sugerido != null ? "sugestão do vendedor: " + moeda(i.preco_sugerido) + "/" + un : "sem sugestão"].filter(Boolean).join(" · ") }),
        el("label", { style: "grid-column:1 / -1" }, el("span", { text: "Preço aprovado (R$/" + un + ")" }), ent)));
    });
    var botao = el("button", { type: "button", text: "Aprovar preços", onclick: function () {
      var itens = [], ruim = false;
      campos.forEach(function (c) {
        var v = c.ent.value.trim(); if (!v) return;
        var n = numero(v);
        if (!(n >= 0.01 && n <= 99999)) { ruim = true; c.ent.setAttribute("aria-invalid", "true"); } else { c.ent.removeAttribute("aria-invalid"); itens.push({ item_id: c.id, preco: Math.round(n * 100) / 100 }); }
      });
      if (ruim) return msg(m, "Confira os preços marcados: use valores entre 0,01 e 99.999.", "erro");
      if (!itens.length) return msg(m, "Digite o preço de ao menos um produto.", "erro");
      botao.disabled = true; msg(m, "Gravando…");
      chamar("aprovar-precos", { pedido_id: pid, versao: p.versao, itens: itens }).then(function (r) {
        botao.disabled = false;
        if (r._http === 401) return semSessao();
        if (r.ok) {
          var t = r.itens_pendentes > 0 ? txt(p.pedido) + ": preços gravados; ainda falta o preço de " + r.itens_pendentes + (r.itens_pendentes === 1 ? " produto." : " produtos.")
                                       : txt(p.pedido) + " liberado (" + (r.status === "sugestao" ? "sugestão" : "novo") + "). Total a faturar: " + moeda(r.total_valor) + ".";
          return carregar([t, "ok"]);
        }
        if (r.codigo === "conflito" || r.codigo === "sem_pendencia") return carregar([txt(p.pedido) + ": " + (r.erro || "o pedido mudou") + " A lista foi atualizada.", "erro"]);
        msg(m, (r.erro || "Não foi possível gravar.") + (r.item ? " (produto " + r.item + " da lista enviada)" : ""), "erro");
      });
    } });
    return el("section", { class: "cartao" },
      el("h2", { text: txt(p.pedido) + " · " + txt(p.representada) }),
      el("p", null, el("b", { text: txt(p.cliente) })),
      el("p", { class: "dica", text: ["Vendedor: " + (txt(p.vendedor) || "—"), "Lançado em " + txt(p.lancado_em), "Entrega " + txt(p.entrega)].join(" · ") }),
      corpo,
      el("p", { class: "dica", text: "Pode aprovar só parte dos produtos: o pedido segue quando todos tiverem preço." }),
      el("div", { class: "acoes" }, botao), m);
  }

  if (!token()) semSessao(); else carregar();
})();
