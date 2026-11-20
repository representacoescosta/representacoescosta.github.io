/* Sistema RC — Metas (20/11/2026, v1).
   Meta × faturado em camadas: vendedores → clientes do vendedor → produtos do cliente. Kg ou caixas; Total, PF ou PV.
   Regras (servidor, rc.api_relatorio_metas, iguais ao App RC): Leite fora; produto inativo sem meta; venda sem meta conta;
   esperado pela regra 60/40 dos dias úteis até o prazo (próxima sexta ou último dia útil do mês).
   Cores do % (como no App RC): verde = chegou ao esperado; amarelo = 60% a 99% do esperado; vermelho = abaixo de 60%.
   API: api-relatorios "relatorio-metas". Segurança: quem vê o quê é decidido no servidor (vendedor só vê o dele);
   a tela só mostra o que a API devolve, sempre como texto; ids só uuid. */
(function () {
  "use strict";
  var API = "https://fufwenjnnsvxdgnenpch.supabase.co/functions/v1/api-relatorios/";
  var CHAVE_SESSAO = "rc_sessao";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var NOMES_NIVEL = { vendedor: "Vendedores", cliente: "Clientes", produto: "Produtos" };
  var palco = document.getElementById("palco");
  var estado = { comp: mesAtual(), peso: "total", unidade: "kg", trilha: [{ nivel: "vendedor", filtros: {}, nome: "Vendedores" }] };

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
  function token() { try { return sessionStorage.getItem(CHAVE_SESSAO); } catch (e) { return null; } }
  function n0(v) { return v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }); }
  function n1(v) { return v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function mesAtual() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); }
  function meses() {
    var d = new Date(), r = [];
    for (var i = 0; i < 6; i++) {
      var x = new Date(d.getFullYear(), d.getMonth() - i, 1), v = x.getFullYear() + "-" + ("0" + (x.getMonth() + 1)).slice(-2);
      r.push([v, x.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })]);
    }
    return r;
  }
  function classe(fat, esperado) {
    if (!(esperado > 0)) return fat > 0 ? "v" : "";
    var q = fat / esperado;
    return q >= 1 ? "v" : q >= 0.6 ? "a" : "r";
  }

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
      el("div", null, el("a", { href: "entrar.html" }, el("button", { type: "button", text: "Entrar" })))));
  }

  function filtrosAtuais() {
    var c = estado.trilha[estado.trilha.length - 1], f = {};
    Object.keys(c.filtros).forEach(function (k) { if (UUID.test(c.filtros[k])) f[k] = c.filtros[k]; });
    if (estado.peso !== "total") f.peso = estado.peso;
    return f;
  }

  function carregar() {
    var c = estado.trilha[estado.trilha.length - 1];
    palco.replaceChildren(cabecalho(), el("p", { class: "dica", text: "Carregando…" }));
    chamar("relatorio-metas", { competencia: estado.comp, nivel: c.nivel, filtros: filtrosAtuais() }).then(function (r) {
      if (r._http === 401) return semSessao();
      if (!r.ok || !Array.isArray(r.linhas)) {
        return palco.replaceChildren(cabecalho(), el("section", { class: "cartao" }, el("p", { class: "msg erro", text: r.erro || "Não foi possível carregar. Tente de novo." }),
          el("div", null, el("button", { type: "button", text: "Tentar de novo", onclick: carregar }))));
      }
      palco.replaceChildren(cabecalho(), resumo(r), tabela(r));
    });
  }

  function cabecalho() {
    var selMes = el("select", { "aria-label": "Mês", onchange: function () { estado.comp = selMes.value; carregar(); } });
    meses().forEach(function (m) { selMes.append(el("option", { value: m[0], text: m[1], selected: m[0] === estado.comp })); });
    function troca(chave, opcoes, rotulo) {
      return el("div", { class: "troca", role: "group", "aria-label": rotulo }, opcoes.map(function (o) {
        return el("button", { type: "button", text: o[1], "aria-pressed": estado[chave] === o[0] ? "true" : "false",
          onclick: function () { estado[chave] = o[0]; carregar(); } });
      }));
    }
    var trilha = el("nav", { class: "trilha", "aria-label": "Camadas" });
    estado.trilha.forEach(function (t, i) {
      if (i) trilha.append(el("span", { text: "›" }));
      if (i < estado.trilha.length - 1) trilha.append(el("button", { type: "button", class: "lk", text: t.nome, onclick: function () { estado.trilha = estado.trilha.slice(0, i + 1); carregar(); } }));
      else trilha.append(el("b", { text: t.nome }));
    });
    return el("section", { class: "cartao" },
      el("h1", { text: "Metas" }),
      el("div", { class: "filtros" }, el("label", null, "Mês", selMes),
        troca("unidade", [["kg", "Kg"], ["cx", "Caixas"]], "Unidade"),
        troca("peso", [["total", "Total"], ["PF", "PF"], ["PV", "PV"]], "Tipo de peso"),
        el("button", { type: "button", class: "sec", text: "Atualizar", onclick: carregar })),
      trilha);
  }

  function resumo(r) {
    var cal = r.calendario || {}, t = r.total || {}, cx = estado.unidade === "cx", pct = Number(cal.pct_prazo) || 0;
    var meta = cx ? t.meta_cx : t.meta_kg, fat = cx ? t.faturado_cx : t.faturado_kg, esp = (Number(meta) || 0) * pct;
    var un = cx ? " cx" : " kg";
    var linha = cal.situacao === "encerrado" ? "Mês encerrado: " + n0(cal.uteis) + " dias úteis."
      : cal.situacao === "futuro" ? "Mês ainda não começou."
      : "Dia útil " + n0(cal.k_hoje) + " de " + n0(cal.uteis) + " · esperado hoje " + n1(100 * (Number(cal.pct_hoje) || 0)) + "% da meta · projeção para " + txt(cal.prazo) + ": " + n1(100 * pct) + "% da meta (regra 60/40).";
    return el("section", { class: "cartao" },
      el("div", { class: "resumo" },
        el("div", { class: "caixa" }, el("small", { text: "Meta do mês" }), el("b", { text: n0(meta) + un })),
        el("div", { class: "caixa" }, el("small", { text: "Faturado" }), el("b", { text: n0(fat) + un })),
        el("div", { class: "caixa" }, el("small", { text: "% da meta" }), el("b", null, el("span", { class: "p " + classe(fat, esp), text: (meta > 0 ? n1(100 * fat / meta) : fat > 0 ? "100,0" : "—") + "%" }))),
        el("div", { class: "caixa" }, el("small", { text: "Esperado até " + (txt(cal.prazo) || "o prazo") }), el("b", { text: n0(esp) + un })),
        el("div", { class: "caixa" }, el("small", { text: "Falta para o esperado" }), el("b", { text: n0(Math.max(esp - (Number(fat) || 0), 0)) + un }))),
      el("p", { class: "dica", text: linha + " Leite fica fora das metas; venda sem meta conta no faturado." }));
  }

  function tabela(r) {
    var cx = estado.unidade === "cx", pct = Number((r.calendario || {}).pct_prazo) || 0, un = cx ? "cx" : "kg";
    var c = estado.trilha[estado.trilha.length - 1];
    var corpo = el("tbody");
    if (!r.linhas.length) corpo.append(el("tr", null, el("td", { colspan: "6", class: "dica", text: "Nada para mostrar neste filtro." })));
    r.linhas.forEach(function (l) {
      var cel = Array.isArray(l.celulas) ? l.celulas : [];
      var meta = Number(cx ? cel[1] : cel[3]) || 0, fat = Number(cx ? cel[2] : cel[4]) || 0, esp = meta * pct;
      var nome = txt(cel[0]) || "SEM VENDEDOR", abrir = l.abrir && NOMES_NIVEL[l.abrir.nivel] ? l.abrir : null;
      var tdNome = abrir ? el("button", { type: "button", class: "lk", text: nome, onclick: function () {
        estado.trilha.push({ nivel: abrir.nivel, filtros: abrir.filtros || {}, nome: nome }); carregar();
      } }) : el("span", { text: nome });
      corpo.append(el("tr", null, el("td", null, tdNome), el("td", { class: "num", text: n0(meta) }), el("td", { class: "num", text: n0(fat) }),
        el("td", { class: "num" }, el("span", { class: "p " + classe(fat, esp), text: (meta > 0 ? n1(100 * fat / meta) : fat > 0 ? "100,0" : "—") + "%" })),
        el("td", { class: "num", text: n0(esp) }), el("td", { class: "num", text: n0(Math.max(esp - fat, 0)) })));
    });
    var head = el("thead", null, el("tr", null, el("th", { text: NOMES_NIVEL[c.nivel] }), el("th", { class: "num", text: "Meta (" + un + ")" }),
      el("th", { class: "num", text: "Faturado (" + un + ")" }), el("th", { class: "num", text: "% da meta" }),
      el("th", { class: "num", text: "Esperado (" + un + ")" }), el("th", { class: "num", text: "Falta (" + un + ")" })));
    return el("section", { class: "cartao" },
      c.nivel !== "produto" ? el("p", { class: "dica", text: "Toque no nome para abrir a camada de baixo." }) : null,
      el("div", { class: "rolar" }, el("table", null, head, corpo)));
  }

  if (!token()) semSessao(); else carregar();
})();
