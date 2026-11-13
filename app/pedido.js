/* Sistema RC — Fazer pedido (v2, 13/11/2026).
   Decisões do Eric (13/11/2026): ninguém escolhe vendedor nem representada para fazer pedido.
   - Escolhe o cliente: ele já traz o vendedor de cada representada (vendedor da loja do vínculo).
   - Vendedor só vê os clientes dele (a RLS do pacote e o filtro abaixo). Gestor vê também cliente sem vendedor
     e cadastra o vendedor adequado ali mesmo (api-fichas "salvar-vinculo"; o banco confere a permissão).
   - Representada é só um filtro opcional na busca de produtos. Pedido com produtos de mais de uma representada
     é dividido: um pedido por representada, cada um com o vendedor daquela representada.
   Dados do dia: api-fichas "sincronizar" (carteira, produtos, preços, prazos), guardados só nesta aba e atualizados por diferença.
   Envio: api-pedidos "enviar-pedido", uma chave por representada gerada no aparelho; sem internet fica na fila deste
   aparelho e sobe sozinho quando a conexão volta (reenviar a mesma chave não duplica).
   Segurança: o preço da tela é só uma prévia — o servidor recalcula preço, permissão, carteira e vendedor; nada de HTML
   vindo da API (tudo entra como texto); a sessão fica só nesta aba; a fila guarda só o pedido (nunca a sessão). */
(function () {
  "use strict";
  var BASE = "https://fufwenjnnsvxdgnenpch.supabase.co/functions/v1/";
  var CHAVE_SESSAO = "rc_sessao", CHAVE_PACOTE = "rc_pacote_v1", CHAVE_RASCUNHO = "rc_rascunho_pedido_v2";
  var CHAVE_FILA = "rc_fila_pedidos_v1", CHAVE_ENVIADOS = "rc_pedidos_enviados_v1", CHAVE_USUARIOS = "rc_opcoes_usuarios_v1";
  var TABELAS = ["cliente", "cliente_representada", "endereco", "rede_associativa", "rede_lojas", "representada",
    "condicao_pagamento", "condicao_pagamento_parcela", "linha_produto", "produto", "produto_embalagem",
    "tabela_preco", "tabela_preco_item", "tabela_preco_alvo", "campanha", "campanha_alvo"];
  var PERFIS_GESTOR = { administrador: 1, gestor: 1, backoffice: 1 };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  var palco = document.getElementById("palco");
  var PERFIL = null, NOME = "";
  var P = null;                 // pacote do dia: { dados: {tabela: {id: linha}}, cursores: {tabela: {em,id}}, em }
  var F = null;                 // rascunho do pedido
  var USUARIOS = {};            // id -> nome (api-fichas "opcoes"; a RLS decide: vendedor só se vê)
  var enviando = false;

  /* ---------- utilidades ---------- */
  function $(id) { return document.getElementById(id); }
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
  function msg(m, texto, tipo) { m.textContent = texto || ""; m.className = "msg" + (tipo ? " " + tipo : ""); }
  function ler(armazem, chave, padrao) { try { var v = JSON.parse(armazem.getItem(chave) || "null"); return v === null ? padrao : v; } catch (e) { return padrao; } }
  function gravar(armazem, chave, v) { try { armazem.setItem(chave, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function token() { try { return sessionStorage.getItem(CHAVE_SESSAO); } catch (e) { return null; } }
  function numero(v) { v = String(v === null || v === undefined ? "" : v).trim().replace(/\s|R\$/g, ""); if (v.indexOf(",") >= 0) v = v.replace(/\./g, "").replace(",", "."); var n = Number(v); return v !== "" && isFinite(n) ? n : null; }
  function moeda(v) { return v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  function dec(v, c) { return v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function hoje() { return iso(new Date()); }
  function maisDias(n) { var d = new Date(); d.setDate(d.getDate() + n); return iso(d); }
  function brData(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : ""; }
  function normal(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function soDigitos(s) { return String(s || "").replace(/\D/g, ""); }
  function novaChave() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function ehGestor() { return !!PERFIS_GESTOR[PERFIL]; }

  function chamar(api, acao, dados) {
    var t = token();
    if (!t) return Promise.resolve({ ok: false, _http: 401, erro: "Sessão encerrada. Entre de novo." });
    return fetch(BASE + api + "/" + acao, {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, dados || {}, { token: t }))
    }).then(function (r) {
      return r.json().then(function (j) { j = j && typeof j === "object" && !Array.isArray(j) ? j : {}; j._http = r.status; return j; },
        function () { return { ok: false, _http: r.status, erro: "Resposta inválida. Tente de novo." }; });
    }, function () { return { ok: false, _http: 0, erro: "Sem conexão." }; });
  }
  function semSessao() {
    $("rodape").hidden = true;
    palco.replaceChildren(el("section", { class: "cartao" }, el("h1", { text: "Sessão encerrada" }),
      el("p", { text: "Entre de novo para continuar. O pedido que estava sendo montado fica guardado nesta aba, e os da fila neste aparelho." }),
      el("div", { class: "acoes" }, el("a", { href: "entrar.html" }, el("button", { type: "button", text: "Entrar" })))));
  }

  /* ---------- usuários (nome do vendedor; lista para o gestor cadastrar) ---------- */
  function carregarUsuarios() {
    var guardado = ler(sessionStorage, CHAVE_USUARIOS, null);
    if (guardado && typeof guardado === "object" && !Array.isArray(guardado)) USUARIOS = guardado;
    return chamar("api-fichas", "opcoes", {}).then(function (r) {
      if (!r.ok || !r.opcoes || !Array.isArray(r.opcoes.usuarios)) return;
      var m = {};
      r.opcoes.usuarios.forEach(function (u) { if (u && UUID.test(u.id || "") && typeof u.nome === "string") m[u.id] = u.nome.slice(0, 120); });
      USUARIOS = m; gravar(sessionStorage, CHAVE_USUARIOS, m);
    });
  }
  function nomeUsuario(id) { return (id && USUARIOS[id]) || ""; }

  /* ---------- pacote do dia (sincronia por diferença) ---------- */
  function pacoteVazio() { var d = {}; TABELAS.forEach(function (t) { d[t] = {}; }); return { dados: d, cursores: {}, em: null }; }
  function juntar(res) {
    TABELAS.forEach(function (t) {
      var bloco = res.tabelas && res.tabelas[t]; if (!bloco) return;
      (bloco.linhas || []).forEach(function (l) {
        if (!l || !UUID.test(l.id || "")) return;
        if (l.ativo === false) delete P.dados[t][l.id]; else P.dados[t][l.id] = l;
      });
      if (bloco.cursor) P.cursores[t] = bloco.cursor;
    });
  }
  function sincronizar(voltas) {
    voltas = voltas || 0;
    return chamar("api-fichas", "sincronizar", { desde: P.cursores, limite: 1000 }).then(function (r) {
      if (r._http === 401) { semSessao(); return false; }
      if (!r.ok) return null;
      juntar(r);
      if (r.completo === false && voltas < 30) return sincronizar(voltas + 1);
      P.em = new Date().toISOString();
      gravar(sessionStorage, CHAVE_PACOTE, P);   // aba sem espaço: segue só na memória
      return true;
    });
  }
  function textoPacote(ok) {
    var n = Object.keys(P.dados.cliente).length, m = Object.keys(P.dados.produto).length;
    var quando = P.em ? new Date(P.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
    $("pacote").textContent = (ok === null ? "Sem conexão: usando os dados das " + quando + ". " : quando ? "Dados atualizados às " + quando + ". " : "") +
      n + " clientes · " + m + " produtos";
  }

  /* ---------- carteira: o cliente traz representadas e vendedores ---------- */
  function vigente(x, d) { return x && (!x.vigencia_inicio || x.vigencia_inicio <= d) && (!x.vigencia_fim || x.vigencia_fim >= d); }
  function lista(t) { return Object.keys(P.dados[t]).map(function (k) { return P.dados[t][k]; }); }
  function nomeRep(id) { var r = P.dados.representada[id]; return r ? r.nome_referencia : ""; }
  function temVendedor(v) { return !!(v && v.vendedor_loja_id && v.situacao_carteira !== "sem_vendedor"); }
  function vinculo(clienteId, repId) {
    var d = hoje(), achou = null;
    lista("cliente_representada").forEach(function (v) {
      if (v.cliente_id !== clienteId || v.representada_id !== repId || !vigente(v, d)) return;
      if (!achou || String(v.vigencia_inicio || "") > String(achou.vigencia_inicio || "")) achou = v;
    });
    return achou;
  }
  // Vínculos que contam para pedido: vigentes, não "fechou", da representada existente; vendedor só os com vendedor
  // (a RLS já entrega só a carteira dele); gestor também os sem vendedor (para cadastrar).
  function vinculosDoCliente(clienteId) {
    var d = hoje(), por = {};
    lista("cliente_representada").forEach(function (v) {
      if (v.cliente_id !== clienteId || !vigente(v, d) || v.situacao_carteira === "fechou" || !P.dados.representada[v.representada_id]) return;
      if (!temVendedor(v) && !ehGestor()) return;
      var a = por[v.representada_id];
      if (!a || String(v.vigencia_inicio || "") > String(a.vigencia_inicio || "")) por[v.representada_id] = v;
    });
    return Object.keys(por).map(function (k) { return por[k]; }).sort(function (a, b) { return nomeRep(a.representada_id).localeCompare(nomeRep(b.representada_id), "pt-BR"); });
  }
  function repsComVendedor(clienteId) { return vinculosDoCliente(clienteId).filter(temVendedor).map(function (v) { return v.representada_id; }); }
  function clientesVisiveis() {
    var d = hoje(), ids = {};
    lista("cliente_representada").forEach(function (v) {
      if (!vigente(v, d) || v.situacao_carteira === "fechou" || !P.dados.representada[v.representada_id]) return;
      if (temVendedor(v) || ehGestor()) ids[v.cliente_id] = 1;
    });
    return Object.keys(ids).map(function (id) { return P.dados.cliente[id]; }).filter(Boolean);
  }
  function representadasDoPedido() {
    var ids = {}; F.itens.forEach(function (i) { ids[i.representada_id] = 1; });
    return Object.keys(ids).sort(function (a, b) { return nomeRep(a).localeCompare(nomeRep(b), "pt-BR"); });
  }

  /* ---------- regras de preço (prévia; o servidor confere) ---------- */
  function negociadas(cli, repId) {
    var d = hoje(), por = {};
    lista("tabela_preco_alvo").forEach(function (a) {
      var ok = (a.alvo_tipo === "cliente" && a.alvo_id === cli.id) || (a.alvo_tipo === "rede_lojas" && cli.rede_lojas_id && a.alvo_id === cli.rede_lojas_id) ||
        (a.alvo_tipo === "rede_associativa" && cli.rede_associativa_id && a.alvo_id === cli.rede_associativa_id);
      if (!ok) return;
      var t = P.dados.tabela_preco[a.tabela_preco_id];
      if (!t || t.representada_id !== repId || t.tipo !== "negociada" || t.status !== "oficializada" || !vigente(t, d)) return;
      var p = Number(a.prioridade == null ? 99 : a.prioridade);
      if (!por[t.id] || p < por[t.id].pri) por[t.id] = { t: t, pri: p };
    });
    return Object.keys(por).map(function (k) { return por[k]; }).sort(function (x, y) {
      return x.pri - y.pri || String(y.t.vigencia_inicio).localeCompare(String(x.t.vigencia_inicio)) || (x.t.id < y.t.id ? -1 : 1);
    }).map(function (x) { return x.t; });
  }
  function padrao(repId) {
    var d = hoje(), m = null;
    lista("tabela_preco").forEach(function (t) {
      if (t.representada_id !== repId || t.tipo !== "padrao" || t.status !== "oficializada" || !vigente(t, d)) return;
      if (!m || t.vigencia_inicio > m.vigencia_inicio || (t.vigencia_inicio === m.vigencia_inicio && t.id < m.id)) m = t;
    });
    return m;
  }
  function itemTabela(tabId, prodId) {
    if (!tabId) return null;
    var d = hoje(), m = null;
    lista("tabela_preco_item").forEach(function (i) {
      if (i.tabela_preco_id !== tabId || i.produto_id !== prodId || !vigente(i, d)) return;
      if (!m || String(i.vigencia_inicio || "") > String(m.vigencia_inicio || "")) m = i;
    });
    return m;
  }
  function caixa(prodId) {
    var m = null;
    lista("produto_embalagem").forEach(function (e) { if (e.produto_id === prodId && e.nivel === "caixa") m = e; });
    return m;
  }
  function tabelaDaRep(repId) {
    var c = F.cliente_id && P.dados.cliente[F.cliente_id];
    var negs = c ? negociadas(c, repId) : [], esc = F.tabelas[repId];
    var neg = esc ? negs.filter(function (t) { return t.id === esc; })[0] : negs[0];
    return { negs: negs, neg: neg || null, pad: padrao(repId) };
  }
  // Preço de tabela de um produto para este cliente: {origem: negociada|padrao|null, pu, pc}
  function precoTabela(prod) {
    var t = tabelaDaRep(prod.representada_id), i = null, o = null;
    if (prod.tipo_peso === "LL") return { origem: null, pu: null, pc: null };
    if (t.neg) { i = itemTabela(t.neg.id, prod.id); if (i && i.preco_unidade_venda != null) o = "negociada"; else i = null; }
    if (!o && t.pad) { i = itemTabela(t.pad.id, prod.id); if (i && i.preco_unidade_venda != null) o = "padrao"; else i = null; }
    return { origem: o, pu: i ? Number(i.preco_unidade_venda) : null, pc: i && i.preco_caixa != null ? Number(i.preco_caixa) : null };
  }
  // Mesmo cálculo do servidor (rc.api_enviar_pedido).
  function calcular(linha) {
    var prod = P.dados.produto[linha.produto_id], cx = caixa(linha.produto_id);
    if (!prod || prod.representada_id !== linha.representada_id) return { erro: "Produto não está mais na tabela desta representada." };
    var q = cx ? Number(cx.quantidade_nivel_anterior) : null, peso = cx ? Number(cx.peso_liquido_kg) : null;
    var tb = precoTabela(prod), digitado = linha.preco, origem, preco;
    if (prod.tipo_peso === "LL") {
      if (digitado == null) return { erro: "Leite longa vida: informe o preço deste pedido." };
      origem = "digitado_ll"; preco = digitado;
    } else if (!tb.origem) {
      if (digitado != null && ehGestor()) { origem = "ajuste_gestor"; preco = digitado; }
      else { origem = "pendente_gestor"; preco = digitado; }
    } else if (digitado != null && digitado !== tb.pu) {
      if (!ehGestor()) return { erro: "Só o gestor muda o preço da tabela." };
      origem = "ajuste_gestor"; preco = digitado;
    } else { origem = tb.origem; preco = tb.pu; }
    if (prod.tipo_peso === "PV" && !(peso > 0)) return { erro: "Produto sem peso da caixa cadastrado. Avise o escritório." };
    if (prod.tipo_peso !== "PV" && !((origem === "negociada" || origem === "padrao") && tb.pc != null) && !(q > 0)) return { erro: "Produto sem caixa cadastrada. Avise o escritório." };
    var total = null;
    if (origem !== "pendente_gestor") {
      if (prod.tipo_peso === "PV") total = r2(linha.caixas * peso * preco);
      else if ((origem === "negociada" || origem === "padrao") && tb.pc != null) total = r2(linha.caixas * tb.pc);
      else total = r2(linha.caixas * q * preco);
    }
    return { origem: origem, preco: preco, tabela: tb.pu, total: total, kg: peso > 0 ? Math.round(linha.caixas * peso * 1000) / 1000 : null };
  }
  function unidade(prod) { return prod.tipo_peso === "PV" ? "kg" : "un"; }

  /* ---------- rascunho ---------- */
  function rascunhoNovo() {
    return { grupo: novaChave(), numero_pedido_cliente: "", sem_numeracao: false, entrega: maisDias(1), so_bonificacao: false,
      cliente_id: null, filtro_rep: null, tabelas: {}, chaves: {}, observacao: "", itens: [] };
  }
  function rascunhoValido(f) {
    return f && UUID.test(f.grupo || "") && Array.isArray(f.itens) && f.tabelas && typeof f.tabelas === "object" && f.chaves && typeof f.chaves === "object" &&
      f.itens.every(function (i) { return i && UUID.test(i.produto_id || "") && UUID.test(i.representada_id || ""); });
  }
  function salvarRascunho() { gravar(sessionStorage, CHAVE_RASCUNHO, F); atualizarRodape(); }
  function chaveDaRep(repId) { if (!UUID.test(F.chaves[repId] || "")) F.chaves[repId] = novaChave(); return F.chaves[repId]; }

  /* ---------- tela do pedido ---------- */
  function telaPedido() {
    palco.replaceChildren();
    // 1. Pedido
    var pc = el("input", { autocomplete: "off", maxlength: "40", placeholder: "Ex.: 3807722/L (se o cliente tiver)" }); pc.value = F.numero_pedido_cliente;
    var ent = el("input", { type: "date", min: hoje(), max: maisDias(90), required: true }); ent.value = F.entrega;
    var bon = el("input", { type: "checkbox" }); bon.checked = F.so_bonificacao;
    pc.addEventListener("input", function () { F.numero_pedido_cliente = pc.value; if (pc.value.trim()) F.sem_numeracao = false; salvarRascunho(); });
    ent.addEventListener("change", function () { F.entrega = ent.value; salvarRascunho(); });
    bon.addEventListener("change", function () { F.so_bonificacao = bon.checked; salvarRascunho(); desenharItens(); });
    palco.append(el("section", { class: "cartao" },
      el("h2", null, el("span", { class: "n", text: "1" }), "Pedido"),
      el("div", { class: "duas" },
        el("label", null, el("span", { text: "Nº do pedido do cliente" }), pc),
        el("label", null, el("span", { class: "obrig", text: "Entrega desejada (já vem amanhã)" }), ent)),
      el("label", { class: "marca" }, bon, el("span", null, "Pedido só de bonificação ", el("small", { class: "dica", text: "(todos os itens bonificados; não entra no total a faturar)" })))));
    palco.append(cartaoCliente());
    palco.append(el("section", { class: "cartao", id: "cartaoItem" }));
    palco.append(el("section", { class: "cartao" }, el("h2", null, el("span", { class: "n", text: "4" }), "Itens do pedido"), el("div", { class: "lista", id: "itens" })));
    var obs = el("textarea", { maxlength: "1000", rows: "3", placeholder: "Ex.: entregar pela manhã; falar com o comprador João" }); obs.value = F.observacao;
    obs.addEventListener("input", function () { F.observacao = obs.value; salvarRascunho(); });
    palco.append(el("section", { class: "cartao" }, el("h2", null, el("span", { class: "n", text: "5" }), "Observação ", el("small", { class: "dica", text: "(opcional)" })),
      el("label", null, el("span", { text: "Para o escritório e a fábrica" }), obs)));
    palco.append(quadroFila());
    desenharItem(); desenharItens();
    $("rodape").hidden = false; atualizarRodape();
  }

  function escolherCliente(id) {
    if (F.itens.length && F.cliente_id !== id && !confirm("Trocar o cliente apaga os itens deste pedido. Continuar?")) return;
    if (F.cliente_id !== id) { F.itens = []; F.tabelas = {}; F.chaves = {}; F.filtro_rep = null; }
    F.cliente_id = id; ATUAL = null; salvarRascunho(); trocarCartaoCliente(); desenharItem(); desenharItens();
  }

  function cartaoCliente() {
    var c = el("section", { class: "cartao", id: "cartaoCliente" }, el("h2", null, el("span", { class: "n", text: "2" }), "Cliente"));
    var cli = F.cliente_id && P.dados.cliente[F.cliente_id];
    if (cli) {
      c.append(el("div", { class: "item" },
        el("div", { class: "t", text: cli.nome_referencia || cli.razao_social || "" }),
        el("div", { class: "v" }, el("button", { type: "button", class: "lixo", text: "Trocar", onclick: function () { escolherCliente(null); } })),
        el("div", { class: "s", text: [cli.codigo_rc, cli.cnpj_cpf].filter(Boolean).join(" · ") })));
      if (/^inativo$/i.test(cli.status_rc || "")) c.append(el("div", { class: "aviso erro", text: "Cliente inativo: não recebe pedido." }));
      var vs = vinculosDoCliente(cli.id);
      if (!vs.length) c.append(el("div", { class: "aviso erro", text: "Cliente sem representada vigente na sua carteira." }));
      vs.forEach(function (v) { c.append(blocoRepresentada(cli, v)); });
      return c;
    }
    var busca = el("input", { autocomplete: "off", placeholder: "Nome, código RC, código na representada ou CNPJ" });
    var sug = el("div", { class: "sug" });
    var todos = clientesVisiveis();
    function filtrar() {
      var q = normal(busca.value.trim()), d = soDigitos(busca.value);
      sug.replaceChildren();
      if (!q) { sug.append(el("p", { class: "dica", text: todos.length + " clientes na sua carteira. Digite para procurar." })); return; }
      var achados = todos.filter(function (x) {
        return normal(x.nome_referencia).indexOf(q) >= 0 || normal(x.razao_social).indexOf(q) >= 0 || normal(x.codigo_rc).indexOf(q) >= 0 ||
          (d.length >= 4 && soDigitos(x.cnpj_cpf).indexOf(d) >= 0) ||
          vinculosDoCliente(x.id).some(function (v) { return v.codigo_na_representada && normal(v.codigo_na_representada) === q; });
      }).slice(0, 30);
      if (!achados.length) sug.append(el("p", { class: "dica", text: "Nenhum cliente encontrado na sua carteira." }));
      achados.forEach(function (x) {
        var reps = vinculosDoCliente(x.id).map(function (v) { return nomeRep(v.representada_id) + (temVendedor(v) ? "" : " (sem vendedor)"); });
        sug.append(el("button", { type: "button", onclick: function () { escolherCliente(x.id); } },
          x.nome_referencia || x.razao_social, el("small", { text: [x.codigo_rc, x.cnpj_cpf, reps.join(", ")].filter(Boolean).join(" · ") })));
      });
    }
    busca.addEventListener("input", filtrar);
    c.append(el("label", null, el("span", { class: "obrig", text: "Cliente da carteira" }), busca), sug);
    filtrar();
    return c;
  }
  // Uma linha por representada do cliente: vendedor (ou cadastro do vendedor, só gestor), tabela e prazo.
  function blocoRepresentada(cli, v) {
    var repId = v.representada_id, b = el("div", { class: "item" });
    b.append(el("div", { class: "t", text: nomeRep(repId) }), el("div", { class: "v" }),
      el("div", { class: "s", text: [v.codigo_na_representada ? "Cód. " + v.codigo_na_representada : "",
        temVendedor(v) ? "Vendedor: " + (nomeUsuario(v.vendedor_loja_id) || "cadastrado na carteira") : "SEM VENDEDOR"].filter(Boolean).join(" · ") }));
    if (!temVendedor(v)) { b.append(cadastrarVendedor(v)); return b; }
    var t = tabelaDaRep(repId);
    if (t.negs.length > 1) {
      var s = el("select");
      t.negs.forEach(function (x) { var o = el("option", { value: x.id, text: x.nome }); if (t.neg && x.id === t.neg.id) o.selected = true; s.append(o); });
      s.addEventListener("change", function () { F.tabelas[repId] = s.value; salvarRascunho(); trocarCartaoCliente(); desenharItem(); desenharItens(); });
      b.append(el("label", { style: "grid-column:1/-1" }, el("span", { text: "Mais de uma tabela negociada vigente" }), s));
    } else b.append(el("div", { class: "s", text: t.neg ? "Tabela negociada: " + t.neg.nome : t.pad ? "Tabela padrão: " + t.pad.nome : "Sem tabela de preço vigente: os itens ficam aguardando o preço do gestor." }));
    if (!v.condicao_pagamento_id) b.append(el("div", { class: "s", text: "Prazo de pagamento não cadastrado: o pedido entra, com aviso ao escritório." }));
    return b;
  }
  // Cliente sem vendedor nesta representada: só o gestor chega aqui e cadastra o vendedor da loja (api-fichas salvar-vinculo;
  // o banco confere a permissão e guarda o histórico). Sem vendedor não se lança item dessa representada.
  function cadastrarVendedor(v) {
    var caixaV = el("div", { class: "aviso", style: "grid-column:1/-1" }), m = el("p", { class: "msg" });
    if (!ehGestor()) { caixaV.textContent = "Sem vendedor nesta representada. Fale com o escritório."; return caixaV; }
    var s = el("select"); s.append(el("option", { value: "", text: "Escolha o vendedor" }));
    Object.keys(USUARIOS).sort(function (a, b) { return USUARIOS[a].localeCompare(USUARIOS[b], "pt-BR"); })
      .forEach(function (id) { s.append(el("option", { value: id, text: USUARIOS[id] })); });
    var b = el("button", { type: "button", text: "Gravar vendedor", onclick: function () {
      var uid = s.value;
      if (!UUID.test(uid) || !USUARIOS[uid]) return msg(m, "Escolha o vendedor.", "erro");
      if (!Number.isInteger(v.versao)) return msg(m, "Dados desatualizados. Abra a tela de novo.", "erro");
      b.disabled = true; msg(m, "Gravando…");
      chamar("api-fichas", "salvar-vinculo", { id: v.id, versao: v.versao, campos: { vendedor_loja_id: uid, situacao_carteira: "com_vendedor" } }).then(function (r) {
        if (r._http === 401) return semSessao();
        if (!r.ok) { b.disabled = false; return msg(m, r.erro || "Não foi possível gravar.", "erro"); }
        return sincronizar().then(function () { trocarCartaoCliente(); desenharItem(); desenharItens(); });
      });
    } });
    caixaV.append(el("p", { text: "Cadastre agora o vendedor adequado para lançar produtos desta representada." }),
      el("label", null, el("span", { class: "obrig", text: "Vendedor da loja" }), s), el("div", { class: "acoes" }, b), m);
    if (!Object.keys(USUARIOS).length) msg(m, "Lista de vendedores indisponível sem internet.", "erro");
    return caixaV;
  }
  function trocarCartaoCliente() { var a = $("cartaoCliente"); if (a) a.replaceWith(cartaoCliente()); atualizarRodape(); }

  var ATUAL = null; // produto escolhido no cartão de item
  function desenharItem() {
    var c = $("cartaoItem"); if (!c) return;
    c.replaceChildren(el("h2", null, el("span", { class: "n", text: "3" }), "Item"));
    if (!F.cliente_id) { c.append(el("p", { class: "dica", text: "Escolha o cliente primeiro: ele traz as representadas, o vendedor e a tabela de preço." })); return; }
    var reps = repsComVendedor(F.cliente_id);
    if (!reps.length) { c.append(el("p", { class: "dica", text: ehGestor() ? "Cadastre o vendedor do cliente (acima) para lançar produtos." : "Cliente sem vendedor. Fale com o escritório." })); return; }
    if (F.filtro_rep && reps.indexOf(F.filtro_rep) < 0) F.filtro_rep = null;
    var m = el("p", { class: "msg" });
    if (!ATUAL) {
      // Filtro opcional por representada (só aparece se o cliente compra de mais de uma)
      if (reps.length > 1) {
        var fl = el("div", { class: "acoes" });
        [null].concat(reps).forEach(function (id) {
          fl.append(el("button", { type: "button", class: F.filtro_rep === id ? null : "sec", text: id ? nomeRep(id) : "Todas",
            onclick: function () { F.filtro_rep = id; salvarRascunho(); desenharItem(); } }));
        });
        c.append(el("p", { class: "dica", text: "Filtrar produtos por representada (opcional):" }), fl);
      }
      var busca = el("input", { autocomplete: "off", placeholder: "Nome ou código do produto" }), sug = el("div", { class: "sug" });
      var permitidas = {}; (F.filtro_rep ? [F.filtro_rep] : reps).forEach(function (id) { permitidas[id] = 1; });
      var prods = lista("produto").filter(function (p) { return permitidas[p.representada_id] && p.status !== "fora_de_linha"; })
        .sort(function (a, b) { return String(a.descricao).localeCompare(String(b.descricao), "pt-BR"); });
      var filtrar = function () {
        var q = normal(busca.value.trim()); sug.replaceChildren();
        var achados = prods.filter(function (p) { return !q || normal(p.descricao).indexOf(q) >= 0 || normal(p.codigo_representada) === q || normal(p.codigo_representada).indexOf(q) === 0; }).slice(0, q ? 40 : 15);
        if (!prods.length) sug.append(el("p", { class: "dica", text: "Nenhum produto ativo." }));
        achados.forEach(function (p) {
          var tb = precoTabela(p);
          sug.append(el("button", { type: "button", onclick: function () { ATUAL = { produto_id: p.id, representada_id: p.representada_id, caixas: null, bonificado: false, preco: null }; desenharItem(); } },
            p.descricao, el("small", { text: [reps.length > 1 ? nomeRep(p.representada_id) : "", p.codigo_representada, p.tipo_peso,
              tb.origem ? moeda(tb.pu) + "/" + unidade(p) : p.tipo_peso === "LL" ? "preço no pedido" : "sem preço na tabela"].filter(Boolean).join(" · ") })));
        });
      };
      busca.addEventListener("input", filtrar);
      c.append(el("label", null, el("span", { text: "Produto" }), busca), sug);
      filtrar();
      return;
    }
    var prod = P.dados.produto[ATUAL.produto_id];
    if (!prod || reps.indexOf(prod.representada_id) < 0) { ATUAL = null; return desenharItem(); }
    var cx = caixa(prod.id), tb = precoTabela(prod);
    var peso = cx ? Number(cx.peso_liquido_kg) : null;
    var qCx = el("input", { class: "grande", inputmode: "numeric", autocomplete: "off", placeholder: "0" });
    var qKg = el("input", { class: "grande", inputmode: "decimal", autocomplete: "off", placeholder: peso > 0 ? "0" : "—", disabled: !(peso > 0) });
    var bon = el("input", { type: "checkbox" }); bon.checked = ATUAL.bonificado || F.so_bonificacao; bon.disabled = F.so_bonificacao;
    var pr = null, rot = null;
    if (prod.tipo_peso === "LL") rot = "Preço deste pedido (R$/" + unidade(prod) + ") — obrigatório";
    else if (!tb.origem) rot = ehGestor() ? "Preço (R$/" + unidade(prod) + ") — sem preço na tabela; se deixar vazio, fica pendente" : "Sugestão de preço (R$/" + unidade(prod) + ") — opcional; o gestor aprova";
    else if (ehGestor()) rot = "Preço deste pedido (R$/" + unidade(prod) + ") — ajuste do gestor";
    if (rot) { pr = el("input", { class: "grande", inputmode: "decimal", autocomplete: "off", placeholder: tb.origem ? dec(tb.pu, 2) + " (tabela)" : "0,00" }); if (ATUAL.preco != null) pr.value = dec(ATUAL.preco, 2); }
    var prev = el("div", { class: "preco" });
    function previa() {
      var n = numero(qCx.value);
      ATUAL.caixas = n && n >= 1 && n <= 9999 && Math.floor(n) === n ? n : null;
      ATUAL.bonificado = bon.checked;
      ATUAL.preco = pr ? numero(pr.value) : null;
      prev.replaceChildren(el("span", { class: "selo" + (tb.origem ? "" : " pend"), text: tb.origem === "negociada" ? "Negociada" : tb.origem === "padrao" ? "Padrão" : prod.tipo_peso === "LL" ? "LL" : "Sem preço" }),
        el("b", { text: tb.origem ? moeda(tb.pu) + "/" + unidade(prod) : "—" }));
      if (ATUAL.caixas) {
        var r = calcular(ATUAL);
        if (r.erro) prev.append(el("span", { class: "msg erro", text: r.erro }));
        else prev.append(el("span", { text: ATUAL.caixas + " cx" + (r.kg ? " · " + dec(r.kg, 3) + " kg" : "") + " · " + (r.total == null ? "aguarda o gestor" : moeda(r.total)) }));
      }
    }
    qCx.addEventListener("input", function () { var n = numero(qCx.value); if (peso > 0) qKg.value = n ? dec(n * peso, 3) : ""; previa(); });
    qKg.addEventListener("input", function () { var k = numero(qKg.value); qCx.value = k && peso > 0 ? String(Math.max(1, Math.round(k / peso))) : ""; previa(); });
    bon.addEventListener("change", previa); if (pr) pr.addEventListener("input", previa);
    var add = el("button", { type: "button", text: "Adicionar ao pedido", onclick: function () {
      previa();
      if (!ATUAL.caixas) return msg(m, "Informe as caixas (número inteiro, de 1 a 9.999).", "erro");
      if (pr && pr.value.trim() && !(ATUAL.preco > 0)) return msg(m, "Preço inválido.", "erro");
      var b = ATUAL.bonificado || F.so_bonificacao;
      if (F.itens.some(function (i) { return i.produto_id === ATUAL.produto_id && (i.bonificado || F.so_bonificacao) === b; }))
        return msg(m, "Este produto já está no pedido" + (b ? " como bonificado" : "") + ". Apague a linha e lance de novo com o total.", "erro");
      if (F.itens.length >= 200) return msg(m, "Até 200 itens por pedido.", "erro");
      var r = calcular(ATUAL); if (r.erro) return msg(m, r.erro, "erro");
      chaveDaRep(prod.representada_id);
      F.itens.push({ produto_id: ATUAL.produto_id, representada_id: prod.representada_id, caixas: ATUAL.caixas, bonificado: b, preco: ATUAL.preco });
      ATUAL = null; salvarRascunho(); desenharItem(); desenharItens();
    } });
    c.append(el("div", { class: "item" }, el("div", { class: "t", text: prod.descricao }),
      el("div", { class: "v" }, el("button", { type: "button", class: "lixo", text: "Trocar", onclick: function () { ATUAL = null; desenharItem(); } })),
      el("div", { class: "s", text: [nomeRep(prod.representada_id), prod.codigo_representada, prod.tipo_peso, cx ? (cx.quantidade_nivel_anterior ? cx.quantidade_nivel_anterior + " un/cx" : "") + (peso ? " · " + dec(peso, 3) + " kg/cx" : "") : "sem caixa cadastrada"].filter(Boolean).join(" · ") })),
      el("div", { class: "duas" }, el("label", null, el("span", { class: "obrig", text: "Caixas" }), qCx), el("label", null, el("span", { text: "Kg" }), qKg)),
      pr ? el("label", null, el("span", { class: prod.tipo_peso === "LL" ? "obrig" : null, text: rot }), pr) : null,
      prev,
      el("label", { class: "marca" }, bon, el("span", null, "Item bonificado ", el("small", { class: "dica", text: "(mesmo preço; não entra no total a faturar)" }))),
      el("div", { class: "acoes" }, add), m);
    if (ATUAL.caixas) qCx.value = String(ATUAL.caixas);
    previa(); qCx.focus();
  }

  function resumo(repId) {
    var t = { cx: 0, kg: 0, valor: 0, bon: 0, pend: 0, erros: 0, n: 0 };
    F.itens.forEach(function (i) {
      if (repId && i.representada_id !== repId) return;
      t.n++;
      var r = calcular(Object.assign({}, i, { bonificado: i.bonificado || F.so_bonificacao }));
      if (r.erro) { t.erros++; return; }
      t.cx += i.caixas; t.kg += r.kg || 0;
      if (r.origem === "pendente_gestor") t.pend++;
      if (i.bonificado || F.so_bonificacao) t.bon += r.total || 0; else t.valor += r.total || 0;
    });
    return t;
  }
  function desenharItens() {
    var l = $("itens"); if (!l) return;
    l.replaceChildren();
    if (!F.itens.length) l.append(el("p", { class: "dica", text: "Nenhum item ainda." }));
    var reps = representadasDoPedido();
    if (reps.length > 1) l.append(el("div", { class: "aviso", text: "Produtos de " + reps.length + " representadas: o envio gera " + reps.length + " pedidos, um por representada, cada um com o seu vendedor." }));
    reps.forEach(function (repId) {
      var v = vinculo(F.cliente_id, repId), t = resumo(repId);
      if (reps.length > 1) l.append(el("p", null, el("b", { text: nomeRep(repId) }), " · " + (temVendedor(v) ? nomeUsuario(v.vendedor_loja_id) : "sem vendedor") + " · " + moeda(t.valor)));
      F.itens.forEach(function (i, n) {
        if (i.representada_id !== repId) return;
        var prod = P.dados.produto[i.produto_id], b = i.bonificado || F.so_bonificacao;
        var r = calcular(Object.assign({}, i, { bonificado: b }));
        l.append(el("div", { class: "item" },
          el("div", { class: "t" }, prod ? prod.descricao : "Produto removido da tabela",
            b ? el("span", { class: "selo bon", text: "Bonificado" }) : null,
            r.origem === "pendente_gestor" ? el("span", { class: "selo pend", text: "Aguarda o gestor" }) : null,
            r.origem === "ajuste_gestor" ? el("span", { class: "selo aj", text: "Preço ajustado" }) : null),
          el("div", { class: "v" }, el("button", { type: "button", class: "lixo", text: "Apagar", "aria-label": "Apagar item", onclick: function () { F.itens.splice(n, 1); salvarRascunho(); desenharItens(); } })),
          el("div", { class: "s", text: r.erro ? r.erro : i.caixas + " cx" + (r.kg ? " · " + dec(r.kg, 3) + " kg" : "") + " · " + (r.preco != null ? moeda(r.preco) + "/" + unidade(prod) : "sem preço") + " · " + (r.total == null ? "total depois da aprovação" : moeda(r.total)) })));
      });
    });
    atualizarRodape();
  }
  function atualizarRodape() {
    var tt = $("totais"); if (!tt || !F) return;
    var t = resumo(null), nr = representadasDoPedido().length;
    tt.replaceChildren(el("b", { text: moeda(t.valor) }), F.itens.length + " itens · " + t.cx + " cx · " + dec(t.kg, 1) + " kg" + (nr > 1 ? " · " + nr + " pedidos" : "") +
      (t.bon ? " · bonificação " + moeda(t.bon) : "") + (t.pend ? " · " + t.pend + " aguardando o gestor" : ""));
    $("revisar").disabled = !F.itens.length || !F.cliente_id;
  }

  /* ---------- revisar e enviar ---------- */
  function problemas() {
    var p = [], cli = F.cliente_id && P.dados.cliente[F.cliente_id];
    if (!cli) p.push("Escolha o cliente.");
    else if (/^inativo$/i.test(cli.status_rc || "")) p.push("Cliente inativo: não recebe pedido.");
    if (!F.itens.length) p.push("Lance ao menos um item.");
    if (F.itens.length > 200) p.push("Até 200 itens por pedido.");
    if (cli) representadasDoPedido().forEach(function (repId) { if (!temVendedor(vinculo(cli.id, repId))) p.push(nomeRep(repId) + ": cliente sem vendedor."); });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(F.entrega || "") || F.entrega < hoje() || F.entrega > maisDias(90)) p.push("Entrega: de hoje até 90 dias.");
    if (/^[=+\-@]/.test(String(F.observacao || "").trim()) || /^[=+\-@]/.test(String(F.numero_pedido_cliente || "").trim())) p.push("Nº do pedido e observação não podem começar com = + - @.");
    if (resumo(null).erros) p.push("Há item com problema (veja a lista).");
    return p;
  }
  function telaRevisar() {
    var pb = problemas();
    if (pb.length) { alertaTopo(pb.join(" "), "erro"); return; }
    $("rodape").hidden = true;
    var cli = P.dados.cliente[F.cliente_id], reps = representadasDoPedido(), tg = resumo(null);
    var conf = null, m = el("p", { class: "msg" });
    var c = el("section", { class: "cartao" }, el("h1", { text: reps.length > 1 ? "Conferir os " + reps.length + " pedidos" : "Conferir o pedido" }),
      el("p", null, el("b", { text: cli.nome_referencia || cli.razao_social })),
      el("p", { class: "dica", text: "Entrega " + brData(F.entrega) + (F.numero_pedido_cliente.trim() ? " · Pedido do cliente " + F.numero_pedido_cliente.trim() : "") }));
    reps.forEach(function (repId) {
      var v = vinculo(cli.id, repId), t = resumo(repId), corpo = el("tbody");
      F.itens.forEach(function (i) {
        if (i.representada_id !== repId) return;
        var prod = P.dados.produto[i.produto_id], b = i.bonificado || F.so_bonificacao, r = calcular(Object.assign({}, i, { bonificado: b }));
        corpo.append(el("tr", null, el("td", { text: prod.descricao + (b ? " (bonificado)" : "") }), el("td", { class: "num", text: String(i.caixas) }),
          el("td", { class: "num", text: r.preco != null ? dec(r.preco, 2) : "—" }), el("td", { class: "num", text: r.total == null ? "aguarda gestor" : moeda(r.total) })));
      });
      c.append(el("p", null, el("b", { text: nomeRep(repId) }), " · Vendedor: " + (nomeUsuario(v.vendedor_loja_id) || "da carteira")),
        el("div", { class: "rolar" }, el("table", null, el("thead", null, el("tr", null, el("th", { text: "Produto" }), el("th", { class: "num", text: "Cx" }), el("th", { class: "num", text: "Preço" }), el("th", { class: "num", text: "Total" }))), corpo)),
        el("p", { class: "dica", text: "A faturar: " + moeda(t.valor) + (t.bon ? " · Bonificação: " + moeda(t.bon) : "") + " · " + t.cx + " cx · " + dec(t.kg, 1) + " kg" }));
      if (t.pend) c.append(el("div", { class: "aviso", text: t.pend + (t.pend === 1 ? " produto sem preço na tabela" : " produtos sem preço na tabela") + ": este pedido fica aguardando a aprovação do gestor." }));
    });
    c.append(el("p", null, el("b", { text: "Total a faturar: " + moeda(tg.valor) }), " · " + tg.cx + " cx · " + dec(tg.kg, 1) + " kg"),
      el("p", { class: "dica", text: "Valores calculados no aparelho; o servidor confere preço, permissão, carteira e vendedor ao receber." }));
    if (!F.numero_pedido_cliente.trim()) {
      conf = el("input", { type: "checkbox" }); conf.checked = F.sem_numeracao;
      c.append(el("div", { class: "aviso" }, el("p", { text: "Pedido sem número do cliente. Confira se o cliente não mandou numeração própria." }),
        el("label", { class: "marca", style: "margin-top:8px" }, conf, el("span", { text: "Confirmo que este pedido não possui numeração própria do cliente." }))));
    }
    var enviar = el("button", { type: "button", text: reps.length > 1 ? "Enviar os " + reps.length + " pedidos" : "Enviar pedido", onclick: function () {
      if (conf && !conf.checked) return msg(m, "Marque a confirmação do pedido sem número.", "erro");
      F.sem_numeracao = !!(conf && conf.checked); salvarRascunho();
      enviar.disabled = true;
      colocarNaFila();
    } });
    c.append(el("div", { class: "acoes" }, enviar, el("button", { type: "button", class: "sec", text: "Voltar e corrigir", onclick: telaPedido })), m);
    palco.replaceChildren(c);
    window.scrollTo(0, 0);
  }
  function alertaTopo(texto, tipo) {
    var a = el("div", { class: "aviso" + (tipo === "erro" ? " erro" : ""), role: "alert", text: texto });
    palco.prepend(a); window.scrollTo(0, 0);
    setTimeout(function () { a.remove(); }, 8000);
  }

  /* ---------- fila de envio (sobrevive a fechar a aba; nunca guarda a sessão) ---------- */
  function fila() { return ler(localStorage, CHAVE_FILA, []); }
  function enviados() { return ler(localStorage, CHAVE_ENVIADOS, []); }
  function corpoDoPedido(f, repId) {
    var p = { chave: chaveDaRep(repId), representada_id: repId, cliente_id: f.cliente_id, entrega: f.entrega, origem: "formulario",
      so_bonificacao: !!f.so_bonificacao, itens: f.itens.filter(function (i) { return i.representada_id === repId; }).map(function (i) {
        var x = { produto_id: i.produto_id, caixas: i.caixas }; if (i.bonificado) x.bonificado = true; if (i.preco != null) x.preco = i.preco; return x;
      }) };
    var n = String(f.numero_pedido_cliente || "").trim(); if (n) p.numero_pedido_cliente = n; else p.sem_numeracao = true;
    var o = String(f.observacao || "").trim(); if (o) p.observacao = o;
    var t = tabelaDaRep(repId); if (t.neg && f.tabelas[repId]) p.tabela_id = t.neg.id;
    return p;
  }
  function colocarNaFila() {
    var cli = P.dados.cliente[F.cliente_id], q = fila(), grupo = F.grupo;
    representadasDoPedido().forEach(function (repId) {
      var corpo = corpoDoPedido(F, repId);
      if (!q.some(function (x) { return x.pedido.chave === corpo.chave; }))
        q.push({ pedido: corpo, grupo: grupo, titulo: nomeRep(repId) + " · " + (cli ? cli.nome_referencia || cli.razao_social : ""), em: new Date().toISOString(), estado: "aguardando" });
    });
    if (!gravar(localStorage, CHAVE_FILA, q)) { alertaTopo("Não foi possível guardar o pedido neste aparelho. Tente de novo.", "erro"); return; }
    F = rascunhoNovo(); salvarRascunho();
    enviarFila().then(function () { telaDepoisDoEnvio(grupo); });
  }
  function enviarFila() {
    if (enviando) return Promise.resolve();
    enviando = true;
    var q = fila(), i = 0;
    function proximo() {
      while (i < q.length && q[i].estado !== "aguardando") i++;
      if (i >= q.length) { enviando = false; mostrarFila(); return Promise.resolve(); }
      var item = q[i];
      return chamar("api-pedidos", "enviar-pedido", { pedido: item.pedido }).then(function (r) {
        var atual = fila(), k = -1;
        atual.forEach(function (x, n) { if (x.pedido.chave === item.pedido.chave) k = n; });
        if (r._http === 401) { enviando = false; mostrarFila(); semSessao(); return; }
        if (r.ok) {
          var env = enviados(); env.unshift({ numero: r.numero, status: r.status, titulo: item.titulo, grupo: item.grupo || null, em: new Date().toISOString(), avisos: (r.avisos || []).slice(0, 5), pendentes: r.itens_pendentes || 0 });
          gravar(localStorage, CHAVE_ENVIADOS, env.slice(0, 30));
          if (k >= 0) atual.splice(k, 1);
          gravar(localStorage, CHAVE_FILA, atual); q = atual; i = 0;
          return proximo();
        }
        if (r._http === 0 || r._http === 429 || r._http >= 500) { enviando = false; mostrarFila(); return; }   // tenta de novo depois
        if (k >= 0) { atual[k].estado = "recusado"; atual[k].erro = textoErro(r); gravar(localStorage, CHAVE_FILA, atual); }
        q = atual; i++;
        return proximo();
      });
    }
    return proximo();
  }
  function textoErro(r) {
    var e = (r && r.erro) || "Pedido recusado.";
    var campos = { entrega: "entrega", numero_pedido_cliente: "nº do pedido do cliente", itens: "itens", chave: "envio", tabela_id: "tabela", preco: "preço", faturar_por_cliente_id: "faturar por" };
    if (r && r.campo) e += " (" + (campos[r.campo] || r.campo) + ")";
    if (r && r.item) e += " (item " + r.item + ")";
    return e;
  }
  function mostrarFila() {
    var q = fila(), a = q.filter(function (x) { return x.estado === "aguardando"; }).length, rec = q.length - a;
    var f = $("fila");
    f.hidden = !q.length;
    f.textContent = (a ? a + (a === 1 ? " pedido na fila (sobe quando houver internet)" : " pedidos na fila (sobem quando houver internet)") : "") + (a && rec ? " · " : "") + (rec ? rec + " recusado" + (rec > 1 ? "s" : "") : "");
    var qd = $("quadroFila"); if (qd) qd.replaceWith(quadroFila());
  }
  function quadroFila() {
    var q = fila(), env = enviados().slice(0, 5);
    var c = el("section", { class: "cartao", id: "quadroFila" }, el("h2", { text: "Pedidos deste aparelho" }));
    if (!q.length && !env.length) { c.hidden = true; return c; }
    q.forEach(function (x, n) {
      c.append(el("div", { class: "item" }, el("div", { class: "t", text: x.titulo }),
        el("div", { class: "v" }, x.estado === "recusado" ? el("button", { type: "button", class: "lixo", text: "Descartar", onclick: function () {
          if (!confirm("Descartar este pedido recusado? Ele não foi gravado no sistema.")) return;
          var a = fila(); a.splice(n, 1); gravar(localStorage, CHAVE_FILA, a); mostrarFila();
        } }) : null),
        el("div", { class: "s", text: x.estado === "recusado" ? "Recusado: " + (x.erro || "") : "Na fila desde " + new Date(x.em).toLocaleString("pt-BR") })));
    });
    env.forEach(function (x) {
      c.append(el("div", { class: "item" }, el("div", { class: "t", text: (x.numero || "") + " · " + x.titulo }),
        el("div", { class: "v", text: x.pendentes ? "Aguarda o gestor" : "Recebido" }),
        el("div", { class: "s", text: "Enviado em " + new Date(x.em).toLocaleString("pt-BR") + (x.avisos && x.avisos.length ? " · " + x.avisos.join(" ") : "") })));
    });
    if (q.some(function (x) { return x.estado === "aguardando"; }))
      c.append(el("div", { class: "acoes" }, el("button", { type: "button", class: "sec", text: "Tentar enviar agora", onclick: function () { enviarFila(); } })));
    return c;
  }
  function telaDepoisDoEnvio(grupo) {
    var q = fila().filter(function (x) { return x.grupo === grupo; }), ok = enviados().filter(function (x) { return x.grupo === grupo; });
    var pend = q.filter(function (x) { return x.estado === "aguardando"; }), rec = q.filter(function (x) { return x.estado === "recusado"; });
    var c = el("section", { class: "cartao" });
    c.append(el("h1", { text: rec.length ? "Atenção: pedido recusado" : pend.length ? "Pedido guardado na fila" : ok.length > 1 ? ok.length + " pedidos recebidos" : "Pedido " + ((ok[0] && ok[0].numero) || "") + " recebido" }));
    ok.forEach(function (x) {
      c.append(el("p", { class: x.pendentes ? "aviso" : "msg ok", text: (x.numero || "") + " · " + x.titulo + (x.pendentes ? " — aguardando o gestor aprovar o preço de " + x.pendentes + (x.pendentes === 1 ? " produto." : " produtos.") : " — recebido.") }));
      if (x.avisos && x.avisos.length) c.append(el("p", { class: "dica", text: x.avisos.join(" ") }));
    });
    rec.forEach(function (x) { c.append(el("div", { class: "aviso erro", text: x.titulo + ": " + x.erro })); });
    if (pend.length) c.append(el("p", { text: "Sem conexão agora para " + pend.length + (pend.length === 1 ? " pedido" : " pedidos") + ". Fica neste aparelho e sobe sozinho quando a internet voltar (abra esta tela de novo se demorar)." }));
    c.append(el("div", { class: "acoes" }, el("button", { type: "button", text: "Novo pedido", onclick: telaPedido })));
    palco.replaceChildren(c, quadroFila());
    window.scrollTo(0, 0);
  }

  /* ---------- início ---------- */
  $("revisar").addEventListener("click", telaRevisar);
  window.addEventListener("online", function () { enviarFila(); });

  function iniciar() {
    if (!token()) return semSessao();
    chamar("api-rc", "sessao", {}).then(function (s) {
      if (!s || !s.ok) { if (s && s._http === 0) return iniciarComPacote(null); return semSessao(); }
      PERFIL = s.perfil; NOME = s.nome || "";
      carregarUsuarios().then(function () { if (F && !ATUAL && $("cartaoCliente")) trocarCartaoCliente(); });   // em paralelo: não atrasa a abertura
      iniciarComPacote(true);
    });
  }
  function iniciarComPacote(online) {
    P = ler(sessionStorage, CHAVE_PACOTE, null);
    if (!P || !P.dados || !P.cursores) P = pacoteVazio();
    TABELAS.forEach(function (t) { if (!P.dados[t]) P.dados[t] = {}; });
    var temDados = Object.keys(P.dados.cliente).length > 0;
    var seguir = function (ok) {
      textoPacote(ok); mostrarFila();
      F = ler(sessionStorage, CHAVE_RASCUNHO, null);
      if (!rascunhoValido(F)) F = rascunhoNovo();
      telaPedido();
      enviarFila();
    };
    if (temDados) seguir(online ? true : null);   // abre na hora com o que tem e atualiza por trás
    if (online === null && !temDados) { palco.replaceChildren(el("section", { class: "cartao" }, el("h1", { text: "Sem conexão" }), el("p", { text: "É preciso internet na primeira vez do dia para baixar a carteira e os preços." }))); return; }
    if (online) sincronizar().then(function (ok) {
      if (ok === false) return;
      if (!temDados) { if (ok) seguir(true); else palco.replaceChildren(el("section", { class: "cartao" }, el("h1", { text: "Não foi possível baixar os dados" }), el("p", { text: "Confira a internet e abra a tela de novo." }))); }
      else { textoPacote(ok ? true : null); if (ok && !ATUAL && $("cartaoCliente")) { trocarCartaoCliente(); desenharItem(); desenharItens(); } }
    });
  }
  iniciar();
})();
