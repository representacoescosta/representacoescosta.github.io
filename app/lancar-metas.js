/* Sistema RC — Lançar metas (26/11/2026, v2.3; v2 de 24/11, v1 de 20/11/2026). v2.1: some o "null" na prévia da planilha. v2.2 (regra do Eric, 26/11): na planilha, célula em branco mantém a meta atual; 0 tira a meta. v2.3: a mesma regra vale sempre, também no "Importar o Excel" (grava em modo ajustar; linha sem caixas mantém; 0 tira; o que não está no arquivo não muda).
   O banco na nuvem é a fonte das metas (decisão do Eric, 20/11). Jeitos de lançar:
   0. planilha de preenchimento (v2, pedido do Eric em 24/11): baixar o .xlsx com uma aba por vendedor (cliente na coluna A,
      produtos da B em diante, metas em caixas), preencher e subir de novo; a tela confere o aceite (soma da equipe > 1,1 × objetivo);
   1. copiar o mês anterior (api-relatorios "metas-copiar"; pede confirmação se o mês já tem metas);
   2. importar o Excel no modelo de hoje — aba com as colunas Vendedor | CNPJ | Código | Caixas (ex.: Metas_Banco_Claude) —
      lido aqui no navegador (só as linhas vão para a API; o arquivo não sai do aparelho) e gravado em modo "substituir";
   3. ajustar cliente a cliente (modo "ajustar"; caixas 0 apaga a linha).
   Segurança: só o gestor grava e baixa a planilha (meta.aprovar, conferido no servidor); a tela só mostra texto; arquivo até 15 MB
   e 4.000 linhas por envio; o servidor confere de novo cliente, produto, caixas e vendedor; o .xlsx é montado e lido aqui. */
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
      var cxTxt = String(o[ix.x] || "").trim(); if (cxTxt === "") continue; /* v2.3: em branco = mantém a meta atual */
      if (!(cx >= 0)) continue;
      linhas.push({ vendedor: ix.v >= 0 ? (o[ix.v] || "").slice(0, 60) : "", cliente: cli.slice(0, 40), produto: prod.slice(0, 20), caixas: Math.round(cx * 1000) / 1000 });
      if (linhas.length > MAX_LINHAS) throw new Error("O arquivo tem mais de " + MAX_LINHAS + " linhas de meta.");
    }
    return ix ? { aba: nome, linhas: linhas } : null;
  }

  /* ---------- planilha de preenchimento (v2, 24/11/2026; pedido do Eric) ----------
     Baixar: um .xlsx gerado aqui no navegador, uma aba por vendedor; coluna A = "RCxxxxx · cliente";
     colunas B em diante = "código · produto"; células = metas em caixas (vazia = sem meta).
     Subir: lê as abas com "Cliente" em A1; cada aba vai em modo "ajustar" com todas as células (vazia = 0, apaga a meta);
     o vendedor é o da loja na carteira (o servidor confere). Aceite: soma da equipe > fator × objetivo (PF e PV, em kg). */
  var CRC = (function () { var t = [], c; for (var n = 0; n < 256; n++) { c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipar(arquivos) { // [{nome, texto}] -> Blob (zip sem compressão)
    var enc = new TextEncoder(), partes = [], central = [], pos = 0;
    arquivos.forEach(function (a) {
      var nome = enc.encode(a.nome), dados = enc.encode(a.texto), crc = crc32(dados);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, dados.length, true); h.setUint32(22, dados.length, true); h.setUint16(26, nome.length, true);
      partes.push(new Uint8Array(h.buffer), nome, dados);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, dados.length, true); c.setUint32(24, dados.length, true); c.setUint16(28, nome.length, true);
      c.setUint32(42, pos, true);
      central.push(new Uint8Array(c.buffer), nome);
      pos += 30 + nome.length + dados.length;
    });
    var tam = central.reduce(function (s, x) { return s + x.length; }, 0), f = new DataView(new ArrayBuffer(22));
    f.setUint32(0, 0x06054b50, true); f.setUint16(8, arquivos.length, true); f.setUint16(10, arquivos.length, true);
    f.setUint32(12, tam, true); f.setUint32(16, pos, true);
    return new Blob(partes.concat(central, [new Uint8Array(f.buffer)]), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  function xesc(s) { return String(s === null || s === undefined ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function colNome(i) { var s = ""; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function celula(ref, v, estilo) {
    var st = estilo ? ' s="' + estilo + '"' : "";
    if (typeof v === "number") return '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>';
    if (v === null || v === undefined || v === "") return estilo ? '<c r="' + ref + '"' + st + '/>' : "";
    return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xesc(v) + '</t></is></c>';
  }
  function abaXml(linhas, larguras, congelar) {
    var cols = larguras.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join("");
    var vista = congelar ? '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>' : "";
    var corpo = linhas.map(function (l, r) {
      return '<row r="' + (r + 1) + '">' + l.map(function (v, c) {
        var estilo = r === 0 ? 1 : (congelar && c > 0 ? 2 : 0);
        return celula(colNome(c) + (r + 1), v, estilo);
      }).join("") + "</row>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      vista + (cols ? "<cols>" + cols + "</cols>" : "") + "<sheetData>" + corpo + "</sheetData></worksheet>";
  }
  function nomeAba(s, usados) {
    var b = String(s || "Sem nome").replace(/[\[\]:*?\/\\']/g, " ").trim().slice(0, 31) || "Aba", n = b, i = 2;
    while (usados[n.toLowerCase()]) { n = b.slice(0, 28) + " " + i++; }
    usados[n.toLowerCase()] = 1; return n;
  }
  function montarXlsx(abas) { // [{nome, linhas, larguras, congelar}]
    var usados = {}; abas.forEach(function (a) { a.nome = nomeAba(a.nome, usados); });
    var arq = [];
    arq.push({ nome: "[Content_Types].xml", texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      abas.map(function (a, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join("") + "</Types>" });
    arq.push({ nome: "_rels/.rels", texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
    arq.push({ nome: "xl/workbook.xml", texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      abas.map(function (a, i) { return '<sheet name="' + xesc(a.nome) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join("") + "</sheets></workbook>" });
    arq.push({ nome: "xl/_rels/workbook.xml.rels", texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      abas.map(function (a, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join("") +
      '<Relationship Id="rId' + (abas.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' });
    // estilos: 0 normal; 1 cabeçalho (negrito, fundo laranja claro, quebra de texto); 2 célula de meta (borda fina, fundo amarelo = preencher)
    arq.push({ nome: "xl/styles.xml", texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>' +
      '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDE3D2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF9DB"/></patternFill></fill></fills>' +
      '<borders count="2"><border/><border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
      '<xf numFmtId="1" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' });
    abas.forEach(function (a, i) { arq.push({ nome: "xl/worksheets/sheet" + (i + 1) + ".xml", texto: abaXml(a.linhas, a.larguras || [], a.congelar) }); });
    return zipar(arq);
  }
  function rotuloProduto(p) { return String(p.codigo) + " · " + String(p.nome || "") + " (" + String(p.peso || "") + ")"; }
  function rotuloCliente(c) { return String(c.codigo) + " · " + String(c.nome || ""); }
  function planilhaDoModelo(m, nomeRep, comp) {
    var prods = m.produtos || [], metas = {}, porVend = {};
    (m.metas || []).forEach(function (x) { var k = x.cliente + "|" + x.produto; metas[k] = (metas[k] || 0) + Number(x.caixas || 0); });
    (m.clientes || []).forEach(function (c) { (porVend[c.vendedor] = porVend[c.vendedor] || []).push(c); });
    var o = m.objetivo || {}, t = m.totais || {};
    var leia = [["Planilha de metas " + nomeRep + " · " + nomeMes(comp)],
      ["Uma aba por vendedor. Coluna A: cliente. Da coluna B em diante: produtos. Preencha as metas em caixas nas células amarelas."],
      ["Célula em branco = fica a meta atual. Para tirar a meta de um item naquela loja, escreva 0. Não mude os nomes das abas, a coluna A nem a linha 1."],
      ["Depois de preencher, salve como Excel (.xlsx) e suba em Lançar metas › Planilha de preenchimento."],
      ["As metas são aceitas quando a soma da equipe passa de " + n0(o.fator) + " × o objetivo " + nomeRep + ", em PF e em PV (kg)."],
      [""], ["Objetivo " + nomeRep + " (kg)", "PF", "PV"],
      ["Objetivo", o.pf_kg === undefined ? "" : Number(o.pf_kg), o.pv_kg === undefined ? "" : Number(o.pv_kg)],
      ["Mínimo para aceite", o.pf_kg === undefined ? "" : Math.round(Number(o.pf_kg) * Number(o.fator) * 10) / 10, o.pv_kg === undefined ? "" : Math.round(Number(o.pv_kg) * Number(o.fator) * 10) / 10],
      ["Metas no sistema quando a planilha foi baixada", Number(t.pf_kg || 0), Number(t.pv_kg || 0)]];
    var abas = [{ nome: "Leia-me", linhas: leia, larguras: [48, 14, 14] }];
    Object.keys(porVend).sort().forEach(function (v) {
      var linhas = [["Cliente"].concat(prods.map(rotuloProduto))];
      porVend[v].forEach(function (c) {
        linhas.push([rotuloCliente(c)].concat(prods.map(function (p) { var q = metas[c.codigo + "|" + p.codigo]; return q ? q : ""; })));
      });
      abas.push({ nome: v, linhas: linhas, larguras: [42].concat(prods.map(function () { return 14; })), congelar: true });
    });
    abas.push({ nome: "Produtos", linhas: [["Código", "Produto", "Peso", "kg por caixa"]].concat(prods.map(function (p) { return [String(p.codigo), String(p.nome || ""), String(p.peso || ""), Number(p.kg_caixa || 0)]; })), larguras: [10, 50, 8, 12] });
    return montarXlsx(abas);
  }
  function baixarArquivo(blob, nome) {
    var url = URL.createObjectURL(blob), a = el("a", { href: url, download: nome });
    document.body.append(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  // leitura da planilha preenchida (abas com "Cliente" em A1)
  function lerPreenchida(buf) {
    var texto = lerZip(buf);
    return Promise.all([texto("xl/workbook.xml"), texto("xl/_rels/workbook.xml.rels"), texto("xl/sharedStrings.xml")]).then(function (r) {
      if (!r[0] || !r[1]) throw new Error("O arquivo não é um Excel (.xlsx) válido.");
      var rels = {}; (r[1].match(/<Relationship\b[^>]*>/g) || []).forEach(function (t) { rels[atributo(t, "Id")] = atributo(t, "Target"); });
      var abas = (r[0].match(/<sheet\b[^>]*>/g) || []).map(function (t) {
        var alvo = (rels[atributo(t, "r:id")] || "").replace(/^\/?xl\//, ""); return { nome: atributo(t, "name"), arq: "xl/" + alvo };
      });
      var ss = ((r[2] || "").match(/<si>[\s\S]*?<\/si>/g) || []).map(function (si) { return ent((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(function (t) { return t.replace(/<[^>]+>/g, ""); }).join("")); });
      return Promise.all(abas.map(function (a) { return texto(a.arq).then(function (xml) { return { nome: a.nome, xml: xml || "" }; }); })).then(function (lidas) {
        var res = [], total = 0;
        lidas.forEach(function (a) {
          var rows = a.xml.match(/<row\b[\s\S]*?<\/row>/g) || [], grade = [];
          rows.forEach(function (row) {
            var ri = +atributo(/<row\b[^>]*>/.exec(row)[0], "r") - 1, o = [];
            (row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach(function (c) {
              var tag = /<c\b[^>]*>/.exec(c)[0], t = atributo(tag, "t"), v = /<v>([\s\S]*?)<\/v>/.exec(c), is = /<is>([\s\S]*?)<\/is>/.exec(c);
              o[colIdx(atributo(tag, "r"))] = String(t === "s" ? (ss[+(v ? v[1] : -1)] || "") : t === "inlineStr" ? ent((is ? is[1] : "").replace(/<[^>]+>/g, "")) : v ? ent(v[1]) : "").trim();
            });
            if (ri >= 0 && ri < 2000) grade[ri] = o;
          });
          var cab = grade[0] || [];
          if (String(cab[0] || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() !== "cliente") return;
          var cols = [];
          for (var j = 1; j < cab.length; j++) { var mm = /^\s*([0-9A-Za-z]{1,12})\s*·/.exec(cab[j] || ""); if (mm) cols.push({ j: j, prod: mm[1] }); }
          if (!cols.length) return;
          var itens = [], erros = [];
          for (var i = 1; i < grade.length; i++) {
            var l = grade[i]; if (!l) continue;
            var mc = /^\s*(RC\d{3,10})\b/i.exec(l[0] || "");
            if (!mc) { if (cols.some(function (c) { return (l[c.j] || "") !== ""; })) erros.push("Linha " + (i + 1) + ": cliente sem código RC na coluna A."); continue; }
            cols.forEach(function (c) {
              var s = String(l[c.j] || "").trim().replace(",", "."); if (s === "") return; var q = Number(s); /* v2.2: em branco = mantém a meta atual */
              if (!(q >= 0 && q <= 100000)) { erros.push("Linha " + (i + 1) + ", " + colNome(c.j) + ": valor inválido (" + s.slice(0, 12) + ")."); return; }
              itens.push({ cliente: mc[1].toUpperCase(), produto: c.prod, caixas: Math.round(q * 1000) / 1000 });
            });
          }
          if (itens.length > MAX_LINHAS) throw new Error("A aba " + a.nome + " tem células demais (máximo " + MAX_LINHAS + ").");
          var cx = itens.reduce(function (s, x) { return s + x.caixas; }, 0); total += cx;
          res.push({ aba: a.nome.slice(0, 60), itens: itens, caixas: cx, erros: erros });
        });
        if (!res.length) throw new Error("Não achei abas de vendedor (\"Cliente\" em A1 e produtos da coluna B em diante).");
        return { abas: res, caixas: total };
      });
    });
  }
  function quadroAceite(m) {
    var o = m && m.objetivo, t = (m && m.totais) || {};
    if (!o) return el("p", { class: "msg erro", text: "Este mês ainda não tem o objetivo da representada. Informe abaixo para o sistema conferir o aceite." });
    var pfMin = Number(o.pf_kg) * Number(o.fator), pvMin = Number(o.pv_kg) * Number(o.fator);
    var okPf = Number(t.pf_kg) > pfMin, okPv = Number(t.pv_kg) > pvMin, tb = el("tbody");
    [["PF", o.pf_kg, pfMin, t.pf_kg, okPf], ["PV", o.pv_kg, pvMin, t.pv_kg, okPv]].forEach(function (x) {
      tb.append(el("tr", null, el("td", { text: x[0] }), el("td", { class: "num", text: n0(x[1]) }), el("td", { class: "num", text: n0(x[2]) }),
        el("td", { class: "num", text: n0(x[3]) }), el("td", { text: x[4] ? "Atende" : "Abaixo (faltam " + n0(x[2] - Number(x[3])) + " kg)" })));
    });
    return el("div", null,
      el("p", { class: "msg " + (okPf && okPv ? "ok" : "erro"), text: okPf && okPv ? "Metas aceitas: a soma da equipe passa de " + n0(o.fator) + " × o objetivo em PF e em PV." : "Metas ainda não aceitas: a soma da equipe precisa passar de " + n0(o.fator) + " × o objetivo em PF e em PV." }),
      el("div", { class: "rolar" }, el("table", null, el("thead", null, el("tr", null, el("th", { text: "Peso" }), el("th", { class: "num", text: "Objetivo (kg)" }),
        el("th", { class: "num", text: "Mínimo (kg)" }), el("th", { class: "num", text: "Metas (kg)" }), el("th", { text: "Situação" }))), tb)),
      el("p", { class: "dica", text: n0(t.caixas) + " caixas no mês." }));
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
    var selRep = el("select", { "aria-label": "Representada", onchange: function () { estado.rep = selRep.value; desenhar(); } });
    estado.reps.forEach(function (x) { selRep.append(el("option", { value: x.id, text: String(x.nome || ""), selected: x.id === estado.rep })); });
    var selMes = el("select", { "aria-label": "Mês da meta", onchange: function () { estado.comp = selMes.value; desenhar(); } });
    meses().forEach(function (m) { selMes.append(el("option", { value: m, text: nomeMes(m), selected: m === estado.comp })); });
    function nomeRep() { var x = estado.reps.filter(function (r) { return r.id === selRep.value; })[0]; return x ? String(x.nome || "") : ""; }

    // 0. planilha de preenchimento
    var aceite = el("div"), resPl = el("div"), previaPl = el("div"), lidaPl = null;
    function carregarModelo() {
      aceite.replaceChildren(el("p", { class: "dica", text: "Conferindo as metas do mês…" }));
      return chamar("api-relatorios", "metas-modelo", { competencia: estado.comp, representada_id: selRep.value }).then(function (r) {
        if (r._http === 401) { semSessao(); return null; }
        if (!r.ok) { aceite.replaceChildren(el("p", { class: "msg erro", text: r.erro || "Não foi possível ler as metas." })); return null; }
        aceite.replaceChildren(quadroAceite(r)); return r;
      });
    }
    var btBaixar = el("button", { type: "button", text: "Baixar planilha", onclick: function () {
      btBaixar.disabled = true;
      carregarModelo().then(function (m) {
        btBaixar.disabled = false; if (!m) return;
        if (!(m.produtos || []).length || !(m.clientes || []).length) return resPl.replaceChildren(el("p", { class: "msg erro", text: "Não há clientes ou produtos ativos para montar a planilha." }));
        baixarArquivo(planilhaDoModelo(m, nomeRep(), estado.comp), "Metas " + nomeRep() + " " + estado.comp + " - preencher.xlsx");
        resPl.replaceChildren(el("p", { class: "msg ok", text: "Planilha baixada: " + n0((m.clientes || []).length) + " clientes e " + n0((m.produtos || []).length) + " produtos." }));
      });
    } });
    var arqPl = el("input", { type: "file", accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "aria-label": "Planilha preenchida" });
    var btSubir = el("button", { type: "button", text: "Gravar as metas da planilha", disabled: true });
    arqPl.addEventListener("change", function () {
      lidaPl = null; btSubir.disabled = true; resPl.replaceChildren(); previaPl.replaceChildren();
      var f = arqPl.files && arqPl.files[0]; if (!f) return;
      if (f.size > MAX_ARQ) return previaPl.replaceChildren(el("p", { class: "msg erro", text: "Arquivo grande demais (até 15 MB)." }));
      previaPl.replaceChildren(el("p", { class: "dica", text: "Lendo " + f.name + "…" }));
      f.arrayBuffer().then(lerPreenchida).then(function (x) {
        lidaPl = x;
        var tb = el("tbody"), erros = [];
        x.abas.forEach(function (a) {
          tb.append(el("tr", null, el("td", { text: a.aba + (a.itens.length ? " (" + a.itens.length + " célula(s) preenchidas)" : " (em branco: nada muda)") }), el("td", { class: "num", text: n0(a.caixas) })));
          a.erros.forEach(function (e) { erros.push(a.aba + " · " + e); });
        });
        previaPl.replaceChildren(el("p", null, el("b", { text: f.name + ": " + x.abas.length + " aba(s) de vendedor, " + n0(x.caixas) + " caixas." })),
          el("div", { class: "rolar" }, el("table", null, el("thead", null, el("tr", null, el("th", { text: "Aba" }), el("th", { class: "num", text: "Caixas" }))), tb)),
          erros.length ? el("div", null, el("p", { class: "msg erro", text: erros.length + " célula(s) com problema; corrija e escolha o arquivo de novo." }),
            el("ul", null, erros.slice(0, 50).map(function (e) { return el("li", { text: e }); }))) : "",
          el("p", { class: "dica", text: "Ao gravar, cada cliente × produto com número na planilha recebe esse valor em " + nomeMes(estado.comp) + "; 0 tira a meta; célula em branco e clientes fora da planilha ficam como estão." }));
        btSubir.disabled = erros.length > 0;
      }).catch(function (e) { previaPl.replaceChildren(el("p", { class: "msg erro", text: e && e.message ? e.message : "Não foi possível ler o arquivo." })); });
    });
    btSubir.addEventListener("click", function () {
      if (!lidaPl) return;
      btSubir.disabled = true; arqPl.disabled = true;
      var abas = lidaPl.abas.filter(function (x) { return x.itens.length > 0; }), feitos = [], i = 0; /* aba toda em branco = nada muda */
      function proxima() {
        if (i >= abas.length) {
          arqPl.disabled = false;
          resPl.replaceChildren(el("p", { class: "msg ok", text: "Planilha gravada: " + feitos.length + " aba(s)." }));
          feitos.forEach(function (f) { var c = el("div"); resultado(c, f.r); resPl.append(el("h2", { text: f.aba }), c); });
          carregarModelo();
          return;
        }
        var a = abas[i++];
        resPl.replaceChildren(el("p", { class: "dica", text: "Gravando a aba " + a.aba + " (" + i + " de " + abas.length + ")…" }));
        chamar("api-relatorios", "metas-salvar", { competencia: estado.comp, representada_id: selRep.value, modo: "ajustar", itens: a.itens }).then(function (r) {
          if (r._http === 401) return semSessao();
          feitos.push({ aba: a.aba, r: r });
          if (!r.ok) { arqPl.disabled = false; resPl.replaceChildren(el("p", { class: "msg erro", text: "Parou na aba " + a.aba + ": " + (r.erro || "erro") + ". As abas anteriores já foram gravadas." })); return carregarModelo(); }
          proxima();
        });
      }
      proxima();
    });
    var ePf = el("input", { "aria-label": "Objetivo PF (kg)", inputmode: "decimal", maxlength: "12", placeholder: "kg" });
    var ePv = el("input", { "aria-label": "Objetivo PV (kg)", inputmode: "decimal", maxlength: "12", placeholder: "kg" });
    var mObj = el("p", { class: "msg" });
    var btObj = el("button", { type: "button", class: "sec", text: "Gravar objetivo", onclick: function () {
      var pf = Number(String(ePf.value).trim().replace(/\./g, "").replace(",", ".")), pv = Number(String(ePv.value).trim().replace(/\./g, "").replace(",", "."));
      if (!(String(ePf.value).trim() && String(ePv.value).trim() && pf >= 0 && pv >= 0 && pf <= 10000000 && pv <= 10000000)) return msg(mObj, "Informe PF e PV em kg (números).", "erro");
      btObj.disabled = true; msg(mObj, "");
      chamar("api-relatorios", "metas-objetivo", { competencia: estado.comp, representada_id: selRep.value, pf_kg: pf, pv_kg: pv }).then(function (r) {
        btObj.disabled = false;
        if (r._http === 401) return semSessao();
        if (!r.ok) return msg(mObj, r.erro || "Não foi possível gravar.", "erro");
        msg(mObj, "Objetivo gravado.", "ok"); carregarModelo();
      });
    } });

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
    var btImp = el("button", { type: "button", text: "Importar e gravar as metas do arquivo", disabled: true });
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
          el("p", { class: "dica", text: "Ao importar, cada cliente × produto do arquivo recebe as caixas do arquivo em " + nomeMes(estado.comp) + "; 0 tira a meta; caixas em branco e o que não está no arquivo ficam como estão." }));
        btImp.disabled = false;
      }).catch(function (e) { previa.replaceChildren(el("p", { class: "msg erro", text: e && e.message ? e.message : "Não foi possível ler o arquivo." })); });
    });
    btImp.addEventListener("click", function () {
      if (!lido) return;
      btImp.disabled = true; resImp.replaceChildren(el("p", { class: "dica", text: "Gravando " + n0(lido.linhas.length) + " linhas…" }));
      chamar("api-relatorios", "metas-salvar", { competencia: estado.comp, representada_id: selRep.value, modo: "ajustar", itens: lido.linhas }).then(function (r) {
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
      el("section", { class: "cartao" }, el("h1", { text: "Planilha de preenchimento" }),
        el("p", { class: "dica", text: "Baixe a planilha (uma aba por vendedor: cliente na coluna A, produtos da coluna B em diante, metas em caixas), preencha e suba de novo. O valor digitado substitui a meta do banco." }),
        aceite,
        el("div", { class: "filtros" }, btBaixar),
        el("div", { class: "filtros" }, el("label", null, "Planilha preenchida", arqPl), btSubir), previaPl, resPl,
        el("details", null, el("summary", { text: "Objetivo da representada no mês (kg)" }),
          el("div", { class: "filtros" }, el("label", null, "PF", ePf), el("label", null, "PV", ePv), btObj), mObj)),
      el("section", { class: "cartao" }, el("h1", { text: "1. Copiar de outro mês" }),
        el("div", { class: "filtros" }, el("label", null, "Copiar de", selDe), btCop),
        el("p", { class: "dica", text: "Copia as caixas por cliente e produto. O vendedor vem da carteira de hoje." }), resCop),
      el("section", { class: "cartao" }, el("h1", { text: "2. Importar o Excel" }),
        el("p", { class: "dica", text: "Use o Excel de metas de sempre: a aba com as colunas Vendedor, CNPJ, Código e Caixas (Metas_Banco_Claude). O arquivo é lido aqui; só as linhas vão para o sistema." }),
        el("div", { class: "filtros" }, arq), previa, el("div", { class: "filtros" }, btImp), resImp),
      el("section", { class: "cartao" }, el("h1", { text: "3. Ajustar cliente a cliente" }),
        el("div", { class: "filtros" }, el("label", null, "Cliente", eCli), el("label", null, "Produto", eProd), el("label", null, "Caixas", eCx), el("label", null, "Vendedor", eVen), btAj),
        mAj, el("p", { class: "dica", text: "Caixas 0 apaga a meta desse cliente e produto. Vendedor em branco: o vendedor da loja na carteira." }), resAj));
    carregarModelo();
  }

  if (!token()) semSessao(); else iniciar();
})();
