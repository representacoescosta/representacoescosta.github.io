/* Sistema RC — primeiro acesso (06/11/2026).
   Conversa só com a API do Sistema RC (api-rc). Não guarda senha, chave nem sessão no aparelho.
   Todo texto vindo da API entra na tela como texto (textContent), nunca como HTML. */
(function () {
  "use strict";
  var API = "https://fufwenjnnsvxdgnenpch.supabase.co/functions/v1/api-rc/";
  var token = null, ocupado = false;
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

  function senhaForte(s) { return s.length >= 10 && /[A-Za-z]/.test(s) && /\d/.test(s); }

  $("b1").addEventListener("click", function () {
    if (ocupado) return;
    var email = $("email").value.trim(), convite = $("convite").value.trim(), s = $("senha").value, s2 = $("senha2").value;
    if (!email || !convite || !s) return msg($("m1"), "Preencha e-mail, código e senha.", "erro");
    if (!senhaForte(s)) return msg($("m1"), "A senha precisa de 10 caracteres ou mais, com letras e números.", "erro");
    if (s !== s2) return msg($("m1"), "As duas senhas estão diferentes.", "erro");
    ocupado = true; $("b1").disabled = true; msg($("m1"), "Conferindo…");
    chamar("primeiro-acesso", { email: email, codigo: convite, senha: s }).then(function (r) {
      ocupado = false; $("b1").disabled = false;
      $("senha").value = ""; $("senha2").value = "";
      if (!r || !r.ok) return msg($("m1"), (r && r.erro) || "Não foi possível concluir.", "erro");
      if (r.etapa === "cadastrando_2fa") return mostrar2fa(r);
      concluir(r.nome);
    });
  });

  function mostrar2fa(r) {
    token = r.token;
    var otp = String(r.otpauth || "");
    if (otp.indexOf("otpauth://totp/") !== 0) return msg($("m1"), "Resposta inválida. Peça um novo convite.", "erro");
    var q = qrcode(0, "M"); q.addData(otp); q.make();
    var img = new Image(); img.alt = "QR code das 2 etapas"; img.src = q.createDataURL(6, 2);
    $("qr").replaceChildren(img);
    $("otp").href = otp;
    $("chave").textContent = String(r.segredo || "").replace(/(.{4})/g, "$1 ").trim();
    $("passo1").hidden = true; $("passo2").hidden = false; $("codigo").focus();
  }

  $("b2").addEventListener("click", function () {
    if (ocupado) return;
    var c = $("codigo").value.replace(/\s/g, "");
    if (!/^\d{6}$/.test(c)) return msg($("m2"), "Digite os 6 números do app.", "erro");
    ocupado = true; $("b2").disabled = true; msg($("m2"), "Conferindo…");
    chamar("codigo", { token: token, codigo: c }).then(function (r) {
      ocupado = false; $("b2").disabled = false;
      if (!r || !r.ok) return msg($("m2"), (r && r.erro) || "Código incorreto.", "erro");
      concluir(r.nome);
    });
  });

  function concluir(nome) {
    token = null;
    $("qr").replaceChildren(); $("chave").textContent = ""; $("otp").href = "#";
    $("passo1").hidden = true; $("passo2").hidden = true; $("passo3").hidden = false;
    msg($("m3"), "Tudo certo" + (nome ? ", " + nome : "") + ". Seu acesso está ativo.", "ok");
  }
})();
