/* Sistema RC — Pedidos: gestão e cancelamento (20/11/2026, v1; v2 20/11/2026: pedidos da planilha também — migração 54).
   Regra do Eric (20/11): cancelar sempre com confirmação; o status muda para "cancelado" e quem cancelou fica
   arquivado com a observação do motivo.
   API: api-pedidos "pedidos-gestao" (lista) e "cancelar-pedido" ({ pedido_id, versao, motivo }).
   Antes do faturamento. v2 (regra do Eric, 20/11 18:10: "vindo de planilha, cancela pelo sistema"): pedidos da planilha
   dos últimos 60 dias também aparecem; o cancelamento vai para a planilha pela sincronia (RC Rotinas, até 30 min).
   Segurança: quem pode cancelar é decidido no servidor (permissão pedido.cancelar); motivo conferido aqui (5 a 500)
   e de novo no servidor; versão do pedido conferida (dois gestores ao mesmo tempo); tudo que vem da API entra como
   texto (textContent), nunca como HTML; ids só uuid; sem janelas do navegador (alert/confirm). */
(function () {
  "use strict";
  var API = "https://fufwenjnnsvxdgnenpch.supabase.co/functions/v1/api-pedidos/";
  var CHAVE_SESSAO = "rc_sessao";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var RECARREGA = { conflito: 1, nao_encontrado: 1, ja_cancelado: 1, ja_faturado: 1, pedido_da_planilha: 1, sugestao_da_planilha: 1 };
  var STATUS = { sugestao: "Sugestão", sugestao_confirmada: "Sugestão confirmada", novo: "Novo", aguardando_preco: "Aguardando preço",
    enviado: "Enviado à representada", faturado: "Faturado", cancelado: "Cancelado" };
  var palco = document.getElementById("palco");
  var aberto = null; // id do pedido com a confirmação aberta (Voltar fecha antes de sair)

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
  function moeda(v) { return v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  function status(s) { return STATUS[s] || String(s || ""); }

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
    aberto = null;
    palco.replaceChildren(el("p", { class: "dica", text: "Carregando os pedidos…" }));
    chamar("pedidos-gestao", {}).then(function (r) {
      if (r._http === 401) return semSessao();
      if (r._http === 403) return palco.replaceChildren(el("section", { class: "cartao" }, el("h1", { text: "Só para gestor" }),
        el("p", { text: "Esta tela é de quem pode cancelar pedidos (gestor ou escritório)." })));
      if (!r.ok || !Array.isArray(r.abertos) || !Array.isArray(r.cancelados)) return palco.replaceChildren(el("section", { class: "cartao" },
        el("h1", { text: "Não foi possível carregar" }), el("p", { class: "msg erro", text: r.erro || "Tente de novo em instantes." }),
        el("div", { class: "acoes" }, el("button", { type: "button", text: "Tentar de novo", onclick: function () { carregar(); } }))));
      var topo = el("section", { class: "cartao" },
        el("div", { class: "acoes", style: "justify-content:space-between;align-items:center" },
          el("h1", { text: "Pedidos" }), el("button", { type: "button", class: "sec", text: "Atualizar", onclick: function () { carregar(); } })),
        el("p", { class: "dica", text: "Pedidos dos últimos 60 dias que ainda não foram faturados (sistema novo e planilha). Pedido da planilha cancelado aqui vai para a planilha em até 30 minutos." }));
      if (aviso) topo.append(el("p", { class: "msg " + aviso[1], role: "status", text: aviso[0] }));
      palco.replaceChildren(topo);

      var h2a = el("h2", { text: "Em aberto (" + r.abertos.length + ")" });
      var listaA = el("div", { class: "lista" });
      if (!r.abertos.length) listaA.append(el("p", { class: "dica", text: "Nenhum pedido em aberto no sistema novo." }));
      r.abertos.forEach(function (p) { var c = cartaoAberto(p); if (c) listaA.append(c); });
      palco.append(el("section", { class: "cartao" }, h2a, listaA));

      var listaC = el("div", { class: "lista" });
      if (!r.cancelados.length) listaC.append(el("p", { class: "dica", text: "Nenhum pedido cancelado." }));
      r.cancelados.forEach(function (c) {
        listaC.append(el("div", { class: "item cancelado" },
          el("div", { class: "t" }, txt(c.pedido) + " · " + txt(c.representada), el("span", { class: "selo", text: "Cancelado" })),
          el("div", { class: "v", text: txt(c.cancelado_em) }),
          el("div", { class: "s", text: txt(c.cliente) + " · era: " + status(c.status_anterior) + " · por " + (txt(c.cancelado_por) || "—") +
            (c.na_planilha === false ? " · aguardando a planilha" : c.na_planilha === true ? " · planilha atualizada" : "") }),
          el("div", { class: "s motivo", text: txt(c.motivo) })));
      });
      palco.append(el("section", { class: "cartao" }, el("h2", { text: "Cancelados (arquivo)" }), listaC));
    });
  }

  function cartaoAberto(p) {
    var pid = p && p.pedido && UUID.test(p.pedido.id || "") ? p.pedido.id : null;
    if (!pid) return null;
    var m = el("p", { class: "msg", role: "alert" });
    var area = el("div");
    var botao = el("button", { type: "button", class: "lixo", text: "Cancelar pedido…", onclick: function () { abrirConfirmacao(); } });
    function abrirConfirmacao() {
      aberto = pid; botao.hidden = true;
      var motivo = el("textarea", { rows: "3", maxlength: "500", required: true, "aria-label": "Motivo do cancelamento", placeholder: "Ex.: cliente desistiu; pedido duplicado; erro no produto" });
      var conta = el("span", { class: "dica", text: "0/500" });
      motivo.addEventListener("input", function () { conta.textContent = motivo.value.length + "/500"; });
      var confirmar = el("button", { type: "button", class: "perigo", text: "Confirmar cancelamento de " + txt(p.pedido) });
      var desistir = el("button", { type: "button", class: "sec", text: "Não cancelar", onclick: fechar });
      confirmar.addEventListener("click", function () {
        var t = motivo.value.trim();
        if (t.length < 5) { motivo.setAttribute("aria-invalid", "true"); motivo.focus(); return msg(m, "Escreva o motivo do cancelamento (pelo menos 5 letras).", "erro"); }
        motivo.removeAttribute("aria-invalid");
        confirmar.disabled = true; desistir.disabled = true; msg(m, "Cancelando…");
        chamar("cancelar-pedido", { pedido_id: pid, versao: p.versao, motivo: t }).then(function (r) {
          confirmar.disabled = false; desistir.disabled = false;
          if (r._http === 401) return semSessao();
          if (r.ok) return carregar([txt(p.pedido) + " cancelado. O motivo ficou registrado no histórico do pedido." + (r.planilha ? " A planilha é atualizada na próxima sincronia (até 30 minutos)." : ""), "ok"]);
          if (RECARREGA[r.codigo]) return carregar([txt(p.pedido) + ": " + (r.erro || "o pedido mudou.") + " A lista foi atualizada.", "erro"]);
          msg(m, r.erro || "Não foi possível cancelar.", "erro");
        });
      });
      area.replaceChildren(el("div", { class: "confirma" },
        el("p", null, el("b", { text: "Cancelar " + txt(p.pedido) + " de " + txt(p.cliente) + "?" })),
        el("p", { class: "dica", text: "O pedido passa para \"cancelado\" e não segue para a representada. Fica registrado quem cancelou, quando e o motivo." }),
        el("label", null, el("span", { class: "obrig", text: "Motivo" }), motivo), conta,
        el("div", { class: "acoes" }, confirmar, desistir)));
      motivo.focus();
    }
    function fechar() { aberto = null; area.replaceChildren(); botao.hidden = false; msg(m, ""); }
    var cartao = el("div", { class: "item", style: "grid-template-columns:1fr auto" },
      el("div", { class: "t" }, txt(p.pedido) + " · " + txt(p.representada), el("span", { class: "selo pend", text: status(p.status) }),
        p.origem === "planilha" ? el("span", { class: "selo", text: "Planilha" }) : null),
      el("div", { class: "v", text: moeda(p.total_valor) }),
      el("div", { class: "s", text: txt(p.cliente) }),
      el("div", { class: "s", text: ["Vendedor: " + (txt(p.vendedor) || "—"), "Lançado em " + txt(p.lancado_em), p.total_caixas != null ? String(p.total_caixas) + " cx" : ""].filter(Boolean).join(" · ") }),
      el("div", { style: "grid-column:1 / -1;display:grid;gap:8px" }, el("div", { class: "acoes" }, botao), area, m));
    cartao._fechar = fechar;
    cartao.dataset.pid = pid;
    return cartao;
  }

  // Voltar: se a confirmação de cancelamento estiver aberta, fecha; senão volta para o menu do Sistema RC (Entrar).
  document.getElementById("voltar").addEventListener("click", function () {
    if (aberto) {
      var c = palco.querySelector('[data-pid="' + aberto + '"]');
      if (c && c._fechar) return c._fechar();
    }
    location.href = "entrar.html";
  });

  if (!token()) semSessao(); else carregar();
})();
