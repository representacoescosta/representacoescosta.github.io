/* Sistema RC — Cadastros e Carteira (09/11/2026, v1).
   Conversa só com a API do Sistema RC (api-fichas), com a sessão desta aba (a mesma do "Entrar").
   Segurança: nada de HTML vindo da API (tudo entra como texto); quem pode o quê é decidido no servidor
   (a tela só esconde botões por conveniência); vendedor que cadastra vira sugestão para aprovação. */
(function () {
  "use strict";
  var API = "https://fufwenjnnsvxdgnenpch.supabase.co/functions/v1/api-fichas/";
  var CHAVE = "rc_sessao";
  var O = null;                 // opções (representadas, vendedores, redes, condições, linhas, tabelas, permissões)
  var palco = document.getElementById("palco");
  var UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
  var SITUACOES = [["com_vendedor","Com vendedor"],["sem_vendedor","Sem vendedor"],["centralizado","Centralizado"],["operador_logistico","Operador logístico"],["fechou","Fechou"]];
  var NOME_SIT = {}; SITUACOES.forEach(function (s) { NOME_SIT[s[0]] = s[1]; });

  /* ---------- utilidades ---------- */
  function token() { try { return sessionStorage.getItem(CHAVE); } catch (e) { return null; } }
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
  function txt(v) { return v === null || v === undefined ? "" : typeof v === "object" ? (v.texto || "") : String(v); }
  function idDe(v) { return v && typeof v === "object" ? v.id || null : null; }
  function msg(m, texto, tipo) { m.textContent = texto || ""; m.className = "msg" + (tipo ? " " + tipo : ""); }
  function chamar(acao, dados) {
    var t = token();
    if (!t) { semSessao(); return Promise.resolve({ ok: false, erro: "Sessão encerrada. Entre de novo." }); }
    var corpo = Object.assign({}, dados || {}, { token: t });
    return fetch(API + acao, {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo)
    }).then(function (r) {
      if (r.status === 401) { semSessao(); }
      return r.json().catch(function () { return { ok: false, erro: "Resposta inválida. Tente de novo." }; });
    }, function () { return { ok: false, erro: "Sem conexão. Confira a internet e tente de novo." }; });
  }
  function semSessao() {
    palco.replaceChildren(el("section", { class: "cartao" }, el("h1", { text: "Sessão encerrada" }),
      el("p", { text: "Entre de novo para continuar." }), el("a", { href: "entrar.html", text: "Entrar", class: "dica" })));
  }
  function erroTexto(r) {
    var e = (r && r.erro) || "Não foi possível concluir.";
    var nomes = { cnpj_cpf: "CNPJ/CPF", nome_referencia: "nome de referência", vinculo: "representada", codigo_na_representada: "código na representada",
      prefixo_codigo: "prefixo", situacao_carteira: "situação", cep: "CEP", municipio_ibge: "cidade", obrigatorios: "campos obrigatórios", vigencia_fim: "data de fim", alvos: "grupo de clientes" };
    if (r && r.campo) e += " (" + (nomes[r.campo] || r.campo) + ")";
    if (r && r.item) e += " (linha " + r.item + ")";
    return e;
  }
  function opcoesSel(lista, vazio, atual) {
    var s = el("select");
    if (vazio !== null) s.append(el("option", { value: "", text: vazio }));
    lista.forEach(function (o) { var op = el("option", { value: o[0], text: o[1] }); if (String(atual || "") === String(o[0])) op.selected = true; s.append(op); });
    return s;
  }
  function campo(rotulo, entrada, obrig) { return el("label", null, el("span", { class: obrig ? "obrig" : null, text: rotulo }), entrada); }
  function entrada(tipo, valor, extra) {
    var i = el("input", Object.assign({ type: tipo || "text" }, extra || {}));
    if (valor !== null && valor !== undefined) i.value = valor;
    return i;
  }
  function trava(b, sim) { b.disabled = sim; }
  // Lê um conjunto de campos {chave: elemento}; vazio = null. Com "original", manda só o que mudou.
  function ler(mapa, original) {
    var r = {};
    Object.keys(mapa).forEach(function (k) {
      var e = mapa[k], v;
      if (e.type === "checkbox") v = e.checked;
      else { v = e.value.trim(); if (v === "") v = null; }
      if (e.dataset && e.dataset.bool && v !== null) v = v === "sim";
      if (original) { var o = original[k]; if (o === undefined) o = null; if (String(o) === String(v)) return; }
      r[k] = v;
    });
    return r;
  }
  function limpa(o) { var r = {}; Object.keys(o).forEach(function (k) { if (o[k] !== null && o[k] !== "") r[k] = o[k]; }); return r; }
  function dataISO(br) { var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br || ""); return m ? m[3] + "-" + m[2] + "-" + m[1] : (br || ""); }
  function repNome(id) { var r = (O.representadas || []).filter(function (x) { return x.id === id; })[0]; return r ? r.nome : ""; }
  function listaReps() { return O.representadas.map(function (r) { return [r.id, r.nome + (r.prefixo ? " (" + r.prefixo + ")" : "")]; }); }
  function listaUsu() { return O.usuarios.map(function (u) { return [u.id, u.nome]; }); }
  // "1.234,56" ou "1234,56" → "1234.56"; "12.5" → "12.5"
  function numero(v) { v = String(v || "").trim().replace(/\s|R\$/g, ""); return v.indexOf(",") >= 0 ? v.replace(/\./g, "").replace(",", ".") : v; }
  function moeda(v) { return v === null || v === undefined ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

  /* ---------- abas ---------- */
  var ABAS = { carteira: telaCarteira, cliente: telaCliente, representadas: telaRepresentadas, produtos: telaProdutos, tabelas: telaTabelas };
  document.querySelectorAll("nav.abas button").forEach(function (b) {
    b.addEventListener("click", function () { if (O) abrir(b.dataset.aba); });
  });
  function abrir(aba) {
    document.querySelectorAll("nav.abas button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.aba === aba ? "true" : "false"); });
    palco.replaceChildren();
    ABAS[aba]();
  }
  function recarregarOpcoes() {
    return chamar("opcoes", {}).then(function (r) { if (r && r.ok) O = r.opcoes; return r; });
  }

  /* ---------- Carteira ---------- */
  function telaCarteira() {
    var f = {
      representada_id: opcoesSel(listaReps(), "Todas", null),
      vendedor_id: opcoesSel(listaUsu(), "Todos", null),
      situacao_carteira: opcoesSel(SITUACOES, "Todas", null),
      status_rc: opcoesSel([["ativo","Ativo"],["inativo","Inativo"],["fechou","Fechou"]], "Todos", null),
      busca: entrada("search", null, { maxlength: 60, placeholder: "Nome, código RC, código da representada ou CNPJ" })
    };
    var semCod = el("input", { type: "checkbox" }), gerado = el("input", { type: "checkbox" }), encerr = el("input", { type: "checkbox" });
    var total = el("p", { class: "dica" }), lista = el("div", { class: "lista" }), m = el("p", { class: "msg", role: "alert" });
    var mais = el("button", { type: "button", class: "sec", hidden: true, text: "Carregar mais" });
    var bBusca = el("button", { type: "button", text: "Buscar" });
    var cursor = null;
    function filtros() {
      var x = limpa(ler(f));
      if (semCod.checked) x.sem_codigo = true;
      if (gerado.checked) x.codigo_gerado = true;
      if (encerr.checked) x.incluir_encerrados = true;
      return x;
    }
    function buscar(continuar) {
      trava(bBusca, true); msg(m, "Buscando…");
      chamar("carteira", { filtros: filtros(), cursor: continuar ? cursor : undefined, limite: 100 }).then(function (r) {
        trava(bBusca, false);
        if (!r || !r.ok) return msg(m, erroTexto(r), "erro");
        msg(m, "");
        var c = r.carteira;
        if (!continuar) { lista.replaceChildren(); total.textContent = c.total + (c.total === 1 ? " vínculo" : " vínculos"); }
        c.linhas.forEach(function (l) { lista.append(itemCarteira(l, c.editavel)); });
        cursor = c.proximo; mais.hidden = !cursor;
        if (!continuar && !c.linhas.length) lista.append(el("p", { class: "dica", text: "Nada encontrado com esses filtros." }));
      });
    }
    bBusca.addEventListener("click", function () { buscar(false); });
    f.busca.addEventListener("keydown", function (e) { if (e.key === "Enter") buscar(false); });
    mais.addEventListener("click", function () { buscar(true); });
    palco.append(el("section", { class: "cartao" }, el("h1", { text: "Carteira" }),
      el("div", { class: "grade" }, campo("Representada", f.representada_id), campo("Vendedor", f.vendedor_id),
        campo("Situação", f.situacao_carteira), campo("Status do cliente", f.status_rc)),
      campo("Buscar", f.busca),
      el("div", { class: "acoes" }, el("label", { class: "marca" }, semCod, "Sem código"), el("label", { class: "marca" }, gerado, "Código gerado pelo sistema"),
        el("label", { class: "marca" }, encerr, "Incluir encerrados")),
      el("div", { class: "acoes" }, bBusca), m),
      el("section", { class: "cartao" }, total, lista, mais));
    buscar(false);
  }
  function itemCarteira(l, editavel) {
    var vend = [["Loja", l.vendedor_loja], ["Rede de lojas", l.vendedor_rede_lojas], ["Rede associativa", l.vendedor_rede_associativa]]
      .filter(function (v) { return txt(v[1]); }).map(function (v) { return v[0] + ": " + txt(v[1]); }).join(" · ");
    var it = el("div", { class: "item" },
      el("div", { class: "t" }, txt(l.cliente), el("span", { class: "selo", text: l.codigo_rc })),
      el("div", { class: "s" }, txt(l.representada) + " · código " + (l.codigo_na_representada || "—"),
        l.codigo_gerado ? el("span", { class: "selo gerado", text: "gerado" }) : null),
      el("div", { class: "s", text: (vend || "Sem vendedor") + " · " + (NOME_SIT[l.situacao] || l.situacao) }),
      el("div", { class: "s", text: [l.bairro, l.cidade, l.uf].filter(Boolean).join(" · ") + (l.desde ? "  ·  desde " + l.desde : "") + (l.ate ? " até " + l.ate : "") }));
    if (editavel && !l.ate) {
      var b = el("button", { type: "button", class: "sec", text: "Alterar vínculo" });
      b.addEventListener("click", function () { b.remove(); it.append(formVinculoEditar(l)); });
      it.append(el("div", { class: "acoes" }, b));
    }
    return it;
  }
  function formVinculoEditar(l) {
    var orig = { codigo_na_representada: l.codigo_na_representada, vendedor_loja_id: idDe(l.vendedor_loja), vendedor_rede_lojas_id: idDe(l.vendedor_rede_lojas),
      vendedor_rede_associativa_id: idDe(l.vendedor_rede_associativa), situacao_carteira: l.situacao };
    var f = {
      codigo_na_representada: entrada("text", l.codigo_na_representada, { maxlength: 30 }),
      vendedor_loja_id: opcoesSel(listaUsu(), "—", orig.vendedor_loja_id),
      vendedor_rede_lojas_id: opcoesSel(listaUsu(), "—", orig.vendedor_rede_lojas_id),
      vendedor_rede_associativa_id: opcoesSel(listaUsu(), "—", orig.vendedor_rede_associativa_id),
      situacao_carteira: opcoesSel(SITUACOES, null, l.situacao),
      condicao_pagamento_id: opcoesSel(O.condicoes.map(function (c) { return [c.id, c.nome]; }), "Sem mudança", null),
      limite_credito: entrada("number", null, { min: 0, step: "0.01", placeholder: "Sem mudança" })
    };
    var aPartir = entrada("date"), m = el("p", { class: "msg", role: "alert" });
    var salvar = el("button", { type: "button", text: "Salvar" }), encerrar = el("button", { type: "button", class: "sec", text: "Encerrar vínculo" });
    function enviar(campos) {
      trava(salvar, true); msg(m, "Salvando…");
      chamar("salvar-vinculo", { id: l.vinculo_id, versao: l.versao, campos: campos }).then(function (r) {
        trava(salvar, false);
        if (!r || !r.ok) return msg(m, erroTexto(r), "erro");
        msg(m, r.encerrado ? "Vínculo encerrado." : r.novo_periodo ? "Salvo. Troca de vendedor registrada com novo período." : "Salvo.", "ok");
      });
    }
    salvar.addEventListener("click", function () {
      var c = ler(f, orig);
      if (c.condicao_pagamento_id === null) delete c.condicao_pagamento_id;
      if (c.limite_credito === null) delete c.limite_credito;
      if (!Object.keys(c).length) return msg(m, "Nada mudou.", "erro");
      if (aPartir.value) c.a_partir_de = aPartir.value;
      enviar(c);
    });
    encerrar.addEventListener("click", function () {
      if (!window.confirm("Encerrar este vínculo? O histórico fica guardado.")) return;
      var c = { encerrar: true }; if (aPartir.value) c.a_partir_de = aPartir.value; enviar(c);
    });
    return el("div", { class: "cartao" }, el("div", { class: "grade" },
      campo("Código na representada", f.codigo_na_representada), campo("Vendedor da loja", f.vendedor_loja_id),
      campo("Vendedor da rede de lojas", f.vendedor_rede_lojas_id), campo("Vendedor da rede associativa", f.vendedor_rede_associativa_id),
      campo("Situação", f.situacao_carteira), campo("Condição de pagamento", f.condicao_pagamento_id), campo("Limite de crédito (R$)", f.limite_credito),
      campo("Vale a partir de", aPartir)),
      el("p", { class: "dica", text: "Trocar vendedor fecha o período atual na véspera da data e abre outro (o histórico guarda o vendedor de cada época)." }),
      el("div", { class: "acoes" }, salvar, encerrar), m);
  }

  /* ---------- Cliente (novo ou nova representada para cliente que já existe) ---------- */
  function formVinculo() {
    var f = {
      representada_id: opcoesSel(listaReps(), "Escolha", null),
      codigo_na_representada: entrada("text", null, { maxlength: 30, placeholder: "Vazio = o sistema gera (prefixo + número)" }),
      vendedor_loja_id: opcoesSel(listaUsu(), "—", null),
      vendedor_rede_lojas_id: opcoesSel(listaUsu(), "—", null),
      vendedor_rede_associativa_id: opcoesSel(listaUsu(), "—", null),
      situacao_carteira: opcoesSel(SITUACOES.slice(0, 4), "Automática (pelo vendedor)", null),
      condicao_pagamento_id: opcoesSel(O.condicoes.map(function (c) { return [c.id, c.nome]; }), "—", null),
      limite_credito: entrada("number", null, { min: 0, step: "0.01" }),
      vigencia_inicio: entrada("date")
    };
    var bloco = el("div", { class: "grade" }, campo("Representada", f.representada_id, true), campo("Código na representada", f.codigo_na_representada),
      campo("Vendedor da loja", f.vendedor_loja_id), campo("Vendedor da rede de lojas", f.vendedor_rede_lojas_id),
      campo("Vendedor da rede associativa", f.vendedor_rede_associativa_id), campo("Situação", f.situacao_carteira),
      campo("Condição de pagamento", f.condicao_pagamento_id), campo("Limite de crédito (R$)", f.limite_credito), campo("Cliente desde", f.vigencia_inicio));
    return { bloco: bloco, valor: function () { return limpa(ler(f)); } };
  }
  function telaCliente() {
    var doc = entrada("text", null, { inputmode: "numeric", maxlength: 18, placeholder: "CNPJ ou CPF" });
    var b = el("button", { type: "button", text: "Procurar" }), m = el("p", { class: "msg", role: "alert" }), area = el("div", { class: "lista" });
    function procurar() {
      var d = doc.value.trim();
      if (!/^[0-9./\- ]{11,18}$/.test(d)) return msg(m, "Digite um CNPJ ou CPF.", "erro");
      trava(b, true); msg(m, "Procurando…"); area.replaceChildren();
      chamar("cliente-por-documento", { cnpj_cpf: d }).then(function (r) {
        trava(b, false);
        if (!r || !r.ok) return msg(m, erroTexto(r), "erro");
        msg(m, "");
        if (!r.existe) area.append(formClienteNovo(r.cnpj_cpf));
        else if (r.na_sua_carteira) area.append(clienteExistente(r));
        else area.append(clienteFora(d));
      });
    }
    b.addEventListener("click", procurar);
    doc.addEventListener("keydown", function (e) { if (e.key === "Enter") procurar(); });
    palco.append(el("section", { class: "cartao" }, el("h1", { text: "Cliente" }),
      el("p", { class: "dica", text: "Comece pelo CNPJ/CPF: se já for cliente da RC, o sistema puxa o cadastro e você só acrescenta a representada. Nada é cadastrado duas vezes." }),
      campo("CNPJ ou CPF", doc, true), el("div", { class: "acoes" }, b), m), area);
  }
  function resultadoGravacao(m, r) {
    if (!r || !r.ok) {
      if (r && r.codigo === "ja_vinculado") return msg(m, "Este cliente já está nesta representada. Altere o vínculo pela Carteira.", "erro");
      return msg(m, erroTexto(r), "erro");
    }
    if (r.sugestao) return msg(m, "Sugestão enviada. Um gestor ou o escritório vai aprovar.", "ok");
    msg(m, (r.novo_cliente ? "Cliente cadastrado: " + r.codigo_rc : "Cliente " + r.codigo_rc + " vinculado") +
      (r.codigo_na_representada ? " · código na representada " + r.codigo_na_representada + (r.codigo_gerado ? " (gerado pelo sistema)" : "") : "") + ".", "ok");
  }
  function formClienteNovo(docLimpo) {
    var c = {
      nome_referencia: entrada("text", null, { maxlength: 120 }), razao_social: entrada("text", null, { maxlength: 200 }),
      nome_fantasia: entrada("text", null, { maxlength: 200 }), inscricao_estadual: entrada("text", null, { maxlength: 20 }),
      tipo_cliente: opcoesSel([["loja","Loja"],["cd","Centro de distribuição"],["operador_logistico","Operador logístico"],["atacado","Atacado"]], "—", null),
      dia_visita: opcoesSel([["segunda","Segunda"],["terca","Terça"],["quarta","Quarta"],["quinta","Quinta"],["sexta","Sexta"],["sabado","Sábado"]], "—", null),
      rede_lojas_id: opcoesSel(O.redes_lojas.map(function (x) { return [x.id, x.nome]; }), "—", null),
      rede_associativa_id: opcoesSel(O.redes_associativas.map(function (x) { return [x.id, x.nome]; }), "—", null)
    };
    var e = {
      cep: entrada("text", null, { inputmode: "numeric", maxlength: 9 }), logradouro: entrada("text", null, { maxlength: 200 }),
      numero: entrada("text", null, { maxlength: 20 }), complemento: entrada("text", null, { maxlength: 100 }), bairro: entrada("text", null, { maxlength: 100 })
    };
    var uf = opcoesSel(UFS.map(function (u) { return [u, u]; }), null, "RJ"), cidadeTxt = entrada("text", null, { maxlength: 60, placeholder: "Começo do nome" });
    var cidade = opcoesSel([], "Procure a cidade", null), bCid = el("button", { type: "button", class: "sec", text: "Procurar cidade" });
    bCid.addEventListener("click", function () {
      chamar("municipios", { uf: uf.value, nome: cidadeTxt.value.trim() }).then(function (r) {
        cidade.replaceChildren(el("option", { value: "", text: r && r.ok && r.municipios.length ? "Escolha" : "Nenhuma cidade encontrada" }));
        if (r && r.ok) r.municipios.forEach(function (x) { cidade.append(el("option", { value: x.ibge, text: x.nome })); });
      });
    });
    var v = formVinculo(), m = el("p", { class: "msg", role: "alert" }), b = el("button", { type: "button", text: "Cadastrar" });
    b.addEventListener("click", function () {
      var cli = limpa(ler(c)); cli.cnpj_cpf = docLimpo;
      if (!cli.nome_referencia) return msg(m, "Preencha o nome de referência.", "erro");
      var vin = v.valor();
      if (!vin.representada_id) return msg(m, "Escolha a representada.", "erro");
      var end = limpa(ler(e)); if (cidade.value) end.municipio_ibge = Number(cidade.value);
      trava(b, true); msg(m, "Cadastrando…");
      chamar("novo-cliente", { cliente: cli, endereco: Object.keys(end).length ? end : undefined, vinculo: vin }).then(function (r) {
        trava(b, false); resultadoGravacao(m, r); if (r && r.ok) b.hidden = true;
      });
    });
    return el("section", { class: "cartao" }, el("h2", { text: "Cliente novo · " + docLimpo }),
      el("div", { class: "grade" }, campo("Nome de referência", c.nome_referencia, true), campo("Razão social", c.razao_social), campo("Nome fantasia", c.nome_fantasia),
        campo("Inscrição estadual", c.inscricao_estadual), campo("Tipo", c.tipo_cliente), campo("Dia de visita", c.dia_visita),
        campo("Rede de lojas", c.rede_lojas_id), campo("Rede associativa", c.rede_associativa_id)),
      el("h2", { text: "Endereço" }),
      el("div", { class: "grade" }, campo("CEP", e.cep), campo("Logradouro", e.logradouro), campo("Número", e.numero), campo("Complemento", e.complemento),
        campo("Bairro", e.bairro), campo("UF", uf), campo("Cidade", cidadeTxt), campo("Resultado", cidade)),
      el("div", { class: "acoes" }, bCid),
      el("h2", { text: "Representada e vendedores" }), v.bloco, el("div", { class: "acoes" }, b), m);
  }
  function clienteExistente(r) {
    var lv = el("div", { class: "lista" });
    (r.vinculos || []).forEach(function (x) {
      lv.append(el("div", { class: "item" }, el("div", { class: "t", text: txt(x.representada) }),
        el("div", { class: "s" }, "Código " + (x.codigo_na_representada || "—") + " · " + (NOME_SIT[x.situacao] || x.situacao),
          x.codigo_gerado ? el("span", { class: "selo gerado", text: "gerado" }) : null)));
    });
    if (!(r.vinculos || []).length) lv.append(el("p", { class: "dica", text: "Ainda sem representada." }));
    var v = formVinculo(), m = el("p", { class: "msg", role: "alert" }), b = el("button", { type: "button", text: "Acrescentar representada" });
    b.addEventListener("click", function () {
      var vin = v.valor(); if (!vin.representada_id) return msg(m, "Escolha a representada.", "erro");
      trava(b, true); msg(m, "Salvando…");
      chamar("vincular-cliente", { cliente_id: idDe(r.cliente), vinculo: vin }).then(function (x) { trava(b, false); resultadoGravacao(m, x); });
    });
    return el("section", { class: "cartao" }, el("h2", null, "Já é cliente da RC: " + txt(r.cliente), el("span", { class: "selo", text: r.codigo_rc })),
      r.razao_social ? el("p", { class: "dica", text: r.razao_social }) : null, lv,
      el("h2", { text: "Acrescentar representada" }), v.bloco, el("div", { class: "acoes" }, b), m);
  }
  function clienteFora(doc) {
    var v = formVinculo(), mot = entrada("text", null, { maxlength: 500 }), m = el("p", { class: "msg", role: "alert" }), b = el("button", { type: "button", text: "Enviar sugestão" });
    b.addEventListener("click", function () {
      var vin = v.valor(); if (!vin.representada_id) return msg(m, "Escolha a representada.", "erro");
      trava(b, true);
      chamar("novo-cliente", { cliente: { cnpj_cpf: doc }, vinculo: vin, motivo: mot.value.trim() || undefined }).then(function (x) { trava(b, false); resultadoGravacao(m, x); });
    });
    return el("section", { class: "cartao" }, el("h2", { text: "Este CNPJ/CPF já é cliente da RC, fora da sua carteira" }),
      el("p", { class: "dica", text: "Você pode sugerir a inclusão dele numa representada; um gestor ou o escritório aprova." }),
      v.bloco, campo("Observação", mot), el("div", { class: "acoes" }, b), m);
  }

  /* ---------- Representadas ---------- */
  function telaRepresentadas() {
    var lista = el("div", { class: "lista" }), area = el("div");
    function desenhar() {
      lista.replaceChildren();
      O.representadas.forEach(function (r) {
        var it = el("div", { class: "item" }, el("div", { class: "t" }, r.nome, r.prefixo ? el("span", { class: "selo", text: "prefixo " + r.prefixo }) : el("span", { class: "selo gerado", text: "sem prefixo" })),
          el("div", { class: "s", text: [r.razao_social, r.cnpj, r.email_pedidos].filter(Boolean).join(" · ") }));
        if (O.pode_cadastrar) { var b = el("button", { type: "button", class: "sec", text: "Editar" }); b.addEventListener("click", function () { area.replaceChildren(formRepresentada(r, desenhar)); area.scrollIntoView(); }); it.append(el("div", { class: "acoes" }, b)); }
        lista.append(it);
      });
      if (!O.representadas.length) lista.append(el("p", { class: "dica", text: "Nenhuma representada cadastrada no sistema novo ainda." }));
    }
    var nova = el("button", { type: "button", text: "Nova representada", hidden: !O.pode_cadastrar });
    nova.addEventListener("click", function () { area.replaceChildren(formRepresentada(null, desenhar)); });
    palco.append(el("section", { class: "cartao" }, el("h1", { text: "Representadas" }), el("div", { class: "acoes" }, nova), lista), area);
    desenhar();
  }
  function formRepresentada(r, depois) {
    var o = r || {};
    var f = {
      nome_referencia: entrada("text", o.nome, { maxlength: 120 }), razao_social: entrada("text", o.razao_social, { maxlength: 200 }),
      cnpj: entrada("text", o.cnpj, { inputmode: "numeric", maxlength: 18 }), prefixo_codigo: entrada("text", o.prefixo, { maxlength: 4, placeholder: "Ex.: SM" }),
      email_pedidos: entrada("email", o.email_pedidos, { maxlength: 200 }), percentual_comissao_padrao: entrada("number", o.percentual_comissao_padrao, { min: 0, max: 100, step: "0.01" }),
      contrato_inicio: entrada("date", o.contrato_inicio), contrato_fim: entrada("date", o.contrato_fim),
      fonte_faturamento: opcoesSel([["email_csv","E-mail (CSV)"],["api","API"],["planilha","Planilha"]], "—", o.fonte_faturamento)
    };
    var sug = el("input", { type: "checkbox" }); sug.checked = !!o.usa_sugestao_pedido;
    var orig = r ? { nome_referencia: o.nome, razao_social: o.razao_social, cnpj: o.cnpj, prefixo_codigo: o.prefixo, email_pedidos: o.email_pedidos,
      percentual_comissao_padrao: o.percentual_comissao_padrao, contrato_inicio: o.contrato_inicio, contrato_fim: o.contrato_fim, fonte_faturamento: o.fonte_faturamento } : null;
    var m = el("p", { class: "msg", role: "alert" }), b = el("button", { type: "button", text: r ? "Salvar" : "Cadastrar" });
    b.addEventListener("click", function () {
      var c = r ? ler(f, orig) : limpa(ler(f));
      if (c.prefixo_codigo) c.prefixo_codigo = c.prefixo_codigo.toUpperCase();
      if (c.percentual_comissao_padrao !== undefined && c.percentual_comissao_padrao !== null) c.percentual_comissao_padrao = Number(c.percentual_comissao_padrao);
      if (!r || sug.checked !== !!o.usa_sugestao_pedido) c.usa_sugestao_pedido = sug.checked;
      if (!r && !c.nome_referencia) return msg(m, "Preencha o nome de referência.", "erro");
      if (!Object.keys(c).length) return msg(m, "Nada mudou.", "erro");
      trava(b, true); msg(m, "Salvando…");
      chamar("salvar-representada", { id: r ? r.id : undefined, versao: r ? r.versao : undefined, campos: c }).then(function (x) {
        trava(b, false);
        if (!x || !x.ok) return msg(m, erroTexto(x), "erro");
        msg(m, "Salvo.", "ok"); recarregarOpcoes().then(depois);
      });
    });
    return el("section", { class: "cartao" }, el("h2", { text: r ? "Editar " + o.nome : "Nova representada" }),
      el("div", { class: "grade" }, campo("Nome de referência", f.nome_referencia, true), campo("Razão social", f.razao_social), campo("CNPJ", f.cnpj),
        campo("Prefixo do código gerado", f.prefixo_codigo), campo("E-mail de pedidos", f.email_pedidos), campo("Comissão padrão (%)", f.percentual_comissao_padrao),
        campo("Contrato desde", f.contrato_inicio), campo("Contrato até", f.contrato_fim), campo("Faturamento chega por", f.fonte_faturamento)),
      el("label", { class: "marca" }, sug, "Usa sugestão de pedido"),
      el("p", { class: "dica", text: "Prefixo: 2 a 4 letras/números, com pelo menos uma letra (ex.: SM, GM, 4G). Usado quando a representada ainda não deu código ao cliente: SM0001, SM0002…" }),
      el("div", { class: "acoes" }, b), m);
  }

  /* ---------- Produtos ---------- */
  var BLOCOS = {
    identificacao: ["Identificação", [["codigo_representada","Código na representada","t40",1],["descricao","Descrição","t200",1],["descricao_curta","Descrição curta","t60"],
      ["marca","Marca","t80"],["linha_produto_id","Linha","linha"],["tipo_peso","Tipo de peso","peso",1],["unidades_por_caixa","Unidades por caixa","int",1],
      ["status","Situação","status"],["lancamento_em","Lançamento","data"]]],
    fiscal: ["Fiscal", [["ncm","NCM (8 números)","t10"],["cest","CEST","t9"],["origem_mercadoria","Origem da mercadoria (0 a 8)","int"],["gtin_unidade","EAN da unidade","t14"],["gtin_caixa","DUN da caixa","t14"]]],
    embalagem: ["Embalagem e palete", [["unidade_peso_liquido_kg","Unidade — peso líquido (kg)","dec"],["unidade_peso_bruto_kg","Unidade — peso bruto (kg)","dec"],
      ["unidade_altura_cm","Unidade — altura (cm)","dec"],["unidade_largura_cm","Unidade — largura (cm)","dec"],["unidade_profundidade_cm","Unidade — profundidade (cm)","dec"],
      ["unidades_por_caixa","Caixa — unidades","int"],["caixa_peso_previsto_kg","Caixa — peso previsto (kg)","dec"],["caixa_peso_arredondado_kg","Caixa — peso arredondado do vendedor (kg)","dec"],
      ["caixa_peso_bruto_kg","Caixa — peso bruto (kg)","dec"],["caixa_altura_cm","Caixa — altura (cm)","dec"],["caixa_largura_cm","Caixa — largura (cm)","dec"],
      ["caixa_profundidade_cm","Caixa — profundidade (cm)","dec"],["palete_lastro","Palete — caixas por camada","int"],["palete_altura","Palete — camadas","int"]]],
    conservacao: ["Conservação e mídia", [["validade_dias","Validade (dias)","int"],["conservacao","Conservação","cons"],["temperatura_min_c","Temperatura mínima (°C)","dec"],
      ["temperatura_max_c","Temperatura máxima (°C)","dec"],["registro_sif","Registro SIF","t40"],["registro_orgao","Outro registro (órgão)","t60"],
      ["ingredientes","Ingredientes","t2000"],["alergenicos","Alergênicos","t500"],["contem_gluten","Contém glúten","bool"],["contem_lactose","Contém lactose","bool"],["recebida_em","Ficha recebida em","data"]]]
  };
  function entradaDe(tipo, valor, repId) {
    if (tipo === "peso") return opcoesSel([["PF","Peso fixo (PF)"],["PV","Peso variável (PV)"],["LL","LL"]], "—", valor);
    if (tipo === "status") return opcoesSel([["ativo","Ativo"],["fora_de_linha","Fora de linha"],["sazonal","Sazonal"]], "—", valor);
    if (tipo === "cons") return opcoesSel([["congelado","Congelado"],["resfriado","Resfriado"],["ambiente","Ambiente"]], "—", valor);
    if (tipo === "linha") return opcoesSel(O.linhas.filter(function (l) { return l.representada_id === repId; }).map(function (l) { return [l.id, l.nome]; }), "—", valor);
    if (tipo === "bool") { var s = opcoesSel([["sim","Sim"],["nao","Não"]], "—", valor === true ? "sim" : valor === false ? "nao" : null); s.dataset.bool = "1"; return s; }
    if (tipo === "data") return entrada("date", dataISO(valor));
    if (tipo === "int" || tipo === "dec") return entrada("text", valor, { inputmode: "decimal", maxlength: 14 });
    return entrada("text", valor, { maxlength: Number(tipo.slice(1)) || 200 });
  }
  function telaProdutos() {
    var rep = opcoesSel(listaReps(), "Escolha a representada", null), lista = el("div", { class: "lista" }), area = el("div"), m = el("p", { class: "msg", role: "alert" });
    var nova = el("button", { type: "button", text: "Novo produto", hidden: !O.pode_cadastrar });
    function carregar() {
      lista.replaceChildren(); area.replaceChildren();
      if (!rep.value) return;
      chamar("lista", { tipo: "representada", id: rep.value, aba: "produtos", limite: 100 }).then(function (r) {
        if (!r || !r.ok) return msg(m, erroTexto(r), "erro");
        msg(m, "");
        (r.linhas || []).forEach(function (l) {
          var c = l.celulas || [], b = el("button", { type: "button", class: "sec", text: "Abrir ficha" });
          b.addEventListener("click", function () { abrirProduto(idDe(c[0]) || l.id, rep.value, area); });
          lista.append(el("div", { class: "item" }, el("div", { class: "t", text: txt(c[0]) }),
            el("div", { class: "s", text: "Código " + txt(c[1]) + " · " + txt(c[2]) + " · " + txt(c[3]) }), el("div", { class: "acoes" }, b)));
        });
        if (!(r.linhas || []).length) lista.append(el("p", { class: "dica", text: "Nenhum produto desta representada ainda." }));
      });
    }
    rep.addEventListener("change", carregar);
    nova.addEventListener("click", function () {
      if (!rep.value) return msg(m, "Escolha a representada primeiro.", "erro");
      area.replaceChildren(formBloco(null, "identificacao", {}, rep.value, function (id) { carregar(); abrirProduto(id, rep.value, area); }));
    });
    palco.append(el("section", { class: "cartao" }, el("h1", { text: "Produtos" }), campo("Representada", rep), el("div", { class: "acoes" }, nova), m, lista), area);
  }
  function abrirProduto(id, repId, area) {
    chamar("produto-ficha", { id: id }).then(function (r) {
      if (!r || !r.ok) return area.replaceChildren(el("p", { class: "msg erro", text: erroTexto(r) }));
      var fi = r.ficha, sec = el("section", { class: "cartao" }, el("h2", { text: fi.titulo }));
      fi.blocos.forEach(function (bl) {
        var vals = {}; bl.campos.forEach(function (c) { vals[c.campo] = c.valor; });
        var t = el("table"); bl.campos.forEach(function (c) { t.append(el("tr", null, el("th", { text: c.rotulo }), el("td", { text: txt(c.valor) }))); });
        sec.append(el("h2", { text: bl.titulo }), el("div", { class: "rolar" }, t));
        if (fi.editavel) {
          var b = el("button", { type: "button", class: "sec", text: "Editar " + bl.titulo.toLowerCase() }), lugar = el("div");
          b.addEventListener("click", function () { lugar.replaceChildren(formBloco(fi, bl.bloco, vals, repId, function () { abrirProduto(id, repId, area); })); });
          sec.append(el("div", { class: "acoes" }, b), lugar);
        }
      });
      area.replaceChildren(sec); sec.scrollIntoView();
    });
  }
  function formBloco(fi, bloco, vals, repId, depois) {
    var def = BLOCOS[bloco], f = {}, orig = {};
    def[1].forEach(function (d) {
      var v = vals[d[0]];
      if (d[0] === "ncm" && typeof v === "string") v = v.split(" — ")[0];
      if (d[0] === "linha_produto_id") v = idDe(v);
      f[d[0]] = entradaDe(d[2], v, repId);
      orig[d[0]] = d[2] === "data" ? dataISO(v) || null : d[2] === "bool" ? (v === true ? true : v === false ? false : null) : (v === undefined || v === "" ? null : v);
    });
    var m = el("p", { class: "msg", role: "alert" }), b = el("button", { type: "button", text: fi ? "Salvar" : "Cadastrar produto" });
    b.addEventListener("click", function () {
      var c = fi ? ler(f, orig) : limpa(ler(f));
      def[1].forEach(function (d) { if ((d[2] === "int" || d[2] === "dec") && c[d[0]] !== undefined && c[d[0]] !== null) c[d[0]] = numero(c[d[0]]); });
      if (!fi) {
        c.representada_id = repId;
        if (!c.codigo_representada || !c.descricao || !c.tipo_peso || !c.unidades_por_caixa) return msg(m, "Preencha código, descrição, tipo de peso e unidades por caixa.", "erro");
      }
      if (!Object.keys(c).length) return msg(m, "Nada mudou.", "erro");
      trava(b, true); msg(m, "Salvando…");
      chamar("salvar-produto", { id: fi ? fi.id : undefined, versao: fi ? fi.versao : undefined, bloco: bloco, campos: c }).then(function (x) {
        trava(b, false);
        if (!x || !x.ok) return msg(m, erroTexto(x), "erro");
        msg(m, "Salvo.", "ok"); depois(x.id);
      });
    });
    return el("div", { class: "cartao" }, el("h2", { text: fi ? def[0] : "Novo produto · " + repNome(repId) }),
      el("div", { class: "grade" }, def[1].map(function (d) { return campo(d[1], f[d[0]], !fi && d[3]); })), el("div", { class: "acoes" }, b), m);
  }

  /* ---------- Tabelas de preço ---------- */
  function telaTabelas() {
    var rep = opcoesSel(listaReps(), "Todas", null), lista = el("div", { class: "lista" }), area = el("div");
    var nova = el("button", { type: "button", text: "Nova tabela", hidden: !O.pode_tabela });
    function desenhar() {
      lista.replaceChildren();
      O.tabelas.filter(function (t) { return !rep.value || t.representada_id === rep.value; }).forEach(function (t) {
        var b = el("button", { type: "button", class: "sec", text: "Abrir" });
        b.addEventListener("click", function () { abrirTabela(t.id, area); });
        lista.append(el("div", { class: "item" }, el("div", { class: "t" }, t.nome, el("span", { class: "selo", text: t.tipo === "negociada" ? "negociada" : "padrão" })),
          el("div", { class: "s", text: repNome(t.representada_id) + " · de " + t.inicio + (t.fim ? " até " + t.fim : "") }), el("div", { class: "acoes" }, b)));
      });
      if (!lista.children.length) lista.append(el("p", { class: "dica", text: "Nenhuma tabela." }));
    }
    rep.addEventListener("change", desenhar);
    nova.addEventListener("click", function () { area.replaceChildren(formTabela(desenhar, area)); });
    palco.append(el("section", { class: "cartao" }, el("h1", { text: "Tabelas de preço" }), campo("Representada", rep), el("div", { class: "acoes" }, nova), lista), area);
    desenhar();
  }
  function formTabela(depois, area) {
    var f = { representada_id: opcoesSel(listaReps(), "Escolha", null), nome: entrada("text", null, { maxlength: 120 }),
      tipo: opcoesSel([["padrao","Padrão"],["negociada","Negociada"]], null, "padrao"), uf: opcoesSel(UFS.map(function (u) { return [u, u]; }), "—", null),
      vigencia_inicio: entrada("date"), vigencia_fim: entrada("date") };
    var alvos = [], chips = el("div", { class: "lista" }), grupo = el("div", { class: "cartao", hidden: true });
    function marcar(tipo, id, nome) {
      if (alvos.some(function (a) { return a.tipo === tipo && a.id === id; })) return;
      alvos.push({ tipo: tipo, id: id });
      var x = el("button", { type: "button", class: "sec", text: "Tirar" });
      var it = el("div", { class: "item" }, el("div", { class: "t", text: nome }), el("div", { class: "s", text: { cliente: "Cliente", rede_lojas: "Rede de lojas", rede_associativa: "Rede associativa" }[tipo] }), el("div", { class: "acoes" }, x));
      x.addEventListener("click", function () { alvos = alvos.filter(function (a) { return !(a.tipo === tipo && a.id === id); }); it.remove(); });
      chips.append(it);
    }
    var rl = opcoesSel(O.redes_lojas.map(function (x) { return [x.id, x.nome]; }), "Rede de lojas…", null);
    var ra = opcoesSel(O.redes_associativas.map(function (x) { return [x.id, x.nome]; }), "Rede associativa…", null);
    rl.addEventListener("change", function () { if (rl.value) marcar("rede_lojas", rl.value, rl.options[rl.selectedIndex].text); rl.value = ""; });
    ra.addEventListener("change", function () { if (ra.value) marcar("rede_associativa", ra.value, ra.options[ra.selectedIndex].text); ra.value = ""; });
    var doc = entrada("text", null, { inputmode: "numeric", maxlength: 18, placeholder: "CNPJ do cliente" }), bDoc = el("button", { type: "button", class: "sec", text: "Acrescentar cliente" }), mDoc = el("p", { class: "msg" });
    bDoc.addEventListener("click", function () {
      chamar("cliente-por-documento", { cnpj_cpf: doc.value.trim() }).then(function (r) {
        if (!r || !r.ok) return msg(mDoc, erroTexto(r), "erro");
        if (!r.existe || !r.cliente) return msg(mDoc, "CNPJ não encontrado entre os clientes.", "erro");
        msg(mDoc, ""); marcar("cliente", idDe(r.cliente), txt(r.cliente)); doc.value = "";
      });
    });
    grupo.append(el("h2", { text: "Grupo de clientes da negociada" }), el("div", { class: "grade" }, campo("Rede de lojas", rl), campo("Rede associativa", ra), campo("Cliente", doc)),
      el("div", { class: "acoes" }, bDoc), mDoc, chips);
    f.tipo.addEventListener("change", function () { grupo.hidden = f.tipo.value !== "negociada"; });
    var m = el("p", { class: "msg", role: "alert" }), b = el("button", { type: "button", text: "Salvar tabela" });
    b.addEventListener("click", function () {
      var c = limpa(ler(f));
      if (!c.representada_id || !c.nome || !c.vigencia_inicio) return msg(m, "Preencha representada, nome e data de início.", "erro");
      if (c.tipo === "negociada" && (!c.vigencia_fim || !alvos.length)) return msg(m, "Negociada precisa de data de fim e de pelo menos um cliente ou rede.", "erro");
      trava(b, true); msg(m, "Salvando…");
      chamar("salvar-tabela", { campos: c, alvos: c.tipo === "negociada" ? alvos : undefined }).then(function (x) {
        trava(b, false);
        if (!x || !x.ok) return msg(m, erroTexto(x), "erro");
        recarregarOpcoes().then(function () { depois(); abrirTabela(x.id, area); });
      });
    });
    return el("section", { class: "cartao" }, el("h2", { text: "Nova tabela de preço" }),
      el("div", { class: "grade" }, campo("Representada", f.representada_id, true), campo("Nome", f.nome, true), campo("Tipo", f.tipo), campo("UF", f.uf),
        campo("Vale a partir de", f.vigencia_inicio, true), campo("Vale até", f.vigencia_fim)),
      el("p", { class: "dica", text: "A tabela vale ao salvar, com quem salvou e quando. Negociada: data de fim e grupo de clientes obrigatórios." }),
      grupo, el("div", { class: "acoes" }, b), m);
  }
  function abrirTabela(id, area) {
    chamar("tabela", { id: id, limite: 200 }).then(function (r) {
      if (!r || !r.ok) return area.replaceChildren(el("p", { class: "msg erro", text: erroTexto(r) }));
      var t = r.tabela, tb = el("table", null, el("tr", null, ["Produto", "Código", "Tipo", "Unidade", "Caixa", "R$/kg", "Caixa aprox. (prev./arred.)", "Desde"].map(function (h) { return el("th", { text: h }); })));
      t.linhas.forEach(function (l) {
        tb.append(el("tr", null, [txt(l.produto), l.codigo, l.tipo_peso, moeda(l.preco_unidade), moeda(l.preco_caixa), moeda(l.preco_kg),
          l.tipo_peso === "PV" ? moeda(l.preco_caixa_aprox_previsto) + " / " + moeda(l.preco_caixa_aprox_arredondado) : "", l.desde].map(function (v) { return el("td", { text: v || "" }); })));
      });
      var sec = el("section", { class: "cartao" }, el("h2", { text: t.titulo }),
        el("p", { class: "dica", text: txt(t.representada) + " · " + (t.tabela_tipo === "negociada" ? "negociada" : "padrão") + (t.uf ? " · " + t.uf : "") + " · de " + t.vigencia_inicio + (t.vigencia_fim ? " até " + t.vigencia_fim : "") + (t.salva_em ? " · salva por " + txt(t.salva_por) + " em " + t.salva_em : "") }),
        (t.grupo || []).length ? el("p", { class: "dica", text: "Grupo: " + t.grupo.map(txt).join(", ") }) : null,
        el("div", { class: "rolar" }, tb), t.linhas.length ? null : el("p", { class: "dica", text: "Ainda sem preços." }),
        t.proximo ? el("p", { class: "dica", text: "Mostrando os primeiros 200 produtos." }) : null);
      if (t.editavel) {
        var b = el("button", { type: "button", class: "sec", text: "Lançar ou alterar preços" }), lugar = el("div");
        b.addEventListener("click", function () { b.remove(); formPrecos(t, lugar, function () { abrirTabela(id, area); }); });
        sec.append(el("div", { class: "acoes" }, b), lugar);
      }
      area.replaceChildren(sec); sec.scrollIntoView();
    });
  }
  function formPrecos(t, lugar, depois) {
    var repId = idDe(t.representada), atuais = {};
    t.linhas.forEach(function (l) { atuais[idDe(l.produto)] = l; });
    chamar("lista", { tipo: "representada", id: repId, aba: "produtos", limite: 100 }).then(function (r) {
      if (!r || !r.ok) return lugar.replaceChildren(el("p", { class: "msg erro", text: erroTexto(r) }));
      var linhas = [], tb = el("table", null, el("tr", null, ["Produto", "Tipo", "Preço novo", "Por"].map(function (h) { return el("th", { text: h }); })));
      (r.linhas || []).forEach(function (l) {
        var c = l.celulas || [], pid = idDe(c[0]) || l.id, pv = txt(c[2]) === "PV", a = atuais[pid];
        var preco = entrada("text", null, { inputmode: "decimal", maxlength: 14, placeholder: a ? (pv ? moeda(a.preco_kg) : moeda(a.preco_caixa)) : "" });
        var por = pv ? opcoesSel([["kg","kg"]], null, "kg") : opcoesSel([["caixa","Caixa"],["unidade","Unidade"]], null, "caixa");
        linhas.push({ id: pid, preco: preco, por: por });
        tb.append(el("tr", null, el("td", { text: txt(c[0]) }), el("td", { text: txt(c[2]) }), el("td", null, preco), el("td", null, por)));
      });
      var data = entrada("date"), m = el("p", { class: "msg", role: "alert" }), b = el("button", { type: "button", text: "Gravar preços" });
      b.addEventListener("click", function () {
        var itens = linhas.filter(function (x) { return x.preco.value.trim(); }).map(function (x) { return { produto_id: x.id, por: x.por.value, preco: numero(x.preco.value) }; });
        if (!itens.length) return msg(m, "Preencha pelo menos um preço.", "erro");
        if (itens.length > 200) return msg(m, "No máximo 200 preços por vez.", "erro");
        trava(b, true); msg(m, "Gravando…");
        chamar("salvar-precos", { tabela_id: t.id, versao: t.versao, a_partir_de: data.value || undefined, itens: itens }).then(function (x) {
          trava(b, false);
          if (!x || !x.ok) return msg(m, erroTexto(x), "erro");
          msg(m, x.alterados + " preço(s) gravado(s) a partir de " + x.a_partir_de + ".", "ok"); depois();
        });
      });
      lugar.replaceChildren(el("div", { class: "cartao" }, el("p", { class: "dica", text: "Peso fixo: informe o preço da caixa ou da unidade (o outro é calculado). Peso variável: R$/kg. O preço anterior fica guardado." }),
        el("div", { class: "rolar" }, tb), campo("Vale a partir de (vazio = hoje)", data), el("div", { class: "acoes" }, b), m));
    });
  }

  /* ---------- início ---------- */
  if (!token()) return semSessao();
  recarregarOpcoes().then(function (r) {
    if (!r || !r.ok) { if (token()) palco.replaceChildren(el("p", { class: "msg erro", text: erroTexto(r) })); return; }
    abrir("carteira");
  });
})();
