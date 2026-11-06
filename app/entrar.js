/* Sistema RC — entrada (06/11/2026).
   Conversa só com a API do Sistema RC (api-rc). A senha nunca é guardada. A sessão fica só nesta aba
   (sessionStorage: some ao fechar a aba) e vale o tempo que o servidor decide (administrador: 30 min sem uso).
   Todo texto vindo da API entra na tela como texto (textContent), nunca como HTML. */
(function () {
  "use strict";
  var API = "https://fufwenjnnsvxdgnenpch.supabase.co/functions/v1/api-rc/";
  var CHAVE = "rc_sessao", PERFIS = { administrador: "Administrador", gestor: "Gestor", vendedor: "Vendedor", backoffice: "Escritório", leitura: "Consulta" };
  var tokenCodigo = null, ocupado = false;
  var $ = function (id) { return document.getElementById(id); };

  function msg(el, texto, tipo) { el.textContent = texto || ""; el.className = "msg" + (tipo ? " " + tipo : ""); }
  function chamar(acao, dados) {
    return fetch(API + acao, {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, erro: "Resposta inválida. Tente de novo." }; });
    }, function () { return { ok: false, erro: "Sem conexão. Confira a internet e tente de novo." }; });
  }
  function guardar(t) { try { sessionStorage.setItem(CHAVE, t); } catch (e) {} }
  function lida() { try { return sessionStorage.getItem(CHAVE); } catch (e) { return null; } }
  function esquecer() { try { sessionStorage.removeItem(CHAVE); } catch (e) {} }
  function mostrar(n) { ["passo1", "passo2", "passo3"].forEach(function (p, i) { $(p).hidden = i !== n - 1; }); }
  function trava(b, sim) { ocupado = sim; b.disabled = sim; }

  function abrirSessao(t, m) {
    chamar("sessao", { token: t }).then(function (r) {
      if (!r || !r.ok) { esquecer(); mostrar(1); return msg($("m1"), m ? (r && r.erro) || "Sessão encerrada. Entre de novo." : "", m ? "erro" : ""); }
      guardar(t);
      mostrar(3);
      msg($("m3"), "Olá, " + r.nome + ".", "ok");
      $("info").textContent = "Perfil: " + (PERFIS[r.perfil] || r.perfil) + " · " + r.email;
    });
  }

  $("b1").addEventListener("click", function () {
    if (ocupado) return;
    var e = $("email").value.trim(), s = $("senha").value;
    if (!e || !s) return msg($("m1"), "Preencha e-mail e senha.", "erro");
    trava($("b1"), true); msg($("m1"), "Conferindo…");
    chamar("entrar", { email: e, senha: s }).then(function (r) {
      trava($("b1"), false); $("senha").value = "";
      if (!r || !r.ok) return msg($("m1"), (r && r.erro) || "Não foi possível entrar.", "erro");
      if (r.etapa === "aguardando_2fa") { tokenCodigo = r.token; msg($("m1"), ""); mostrar(2); return $("codigo").focus(); }
      abrirSessao(r.token, true);
    });
  });

  $("b2").addEventListener("click", function () {
    if (ocupado) return;
    var c = $("codigo").value.replace(/\s/g, "");
    if (!/^\d{6}$/.test(c)) return msg($("m2"), "Digite os 6 números do app.", "erro");
    trava($("b2"), true); msg($("m2"), "Conferindo…");
    chamar("codigo", { token: tokenCodigo, codigo: c }).then(function (r) {
      trava($("b2"), false); $("codigo").value = "";
      if (!r || !r.ok) {
        if (/entre de novo/i.test((r && r.erro) || "")) { tokenCodigo = null; mostrar(1); return msg($("m1"), r.erro, "erro"); }
        return msg($("m2"), (r && r.erro) || "Código incorreto.", "erro");
      }
      tokenCodigo = null; msg($("m2"), "");
      abrirSessao(r.token, true);
    });
  });

  $("sair").addEventListener("click", function () {
    var t = lida(); esquecer();
    chamar("sair", { token: t || "" }).then(function () { mostrar(1); msg($("m1"), "Você saiu.", "ok"); });
  });

  ["senha", "codigo"].forEach(function (id) {
    $(id).addEventListener("keydown", function (ev) { if (ev.key === "Enter") $(id === "senha" ? "b1" : "b2").click(); });
  });

  var t = lida();
  if (t) abrirSessao(t, false);
})();
