import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, extractCode, sameSite, baseDomain, senderLabel, decode } from "../src/lib.js";

// [assunto, prévia, código esperado (null = não é e-mail de código)]
const CASES = [
  ["Código de verificação do Google", "G-482913 é seu código de verificação do Google.", "482913"],
  ["482913 é seu código do Google", "Use este código para concluir o login.", "482913"],
  ["Your Spotify login code", "Enter this code to log in: 739204. It expires in 15 minutes.", "739204"],
  ["Código de segurança da conta Microsoft", "Use o código de segurança 5108 para a conta vi***@gmail.com.", "5108"],
  ["Seu código Nubank", "Olá! Seu código de acesso é 381 922. Não compartilhe.", "381922"],
  ["iFood: código de acesso", "Seu código é 2847. Válido por 10 minutos.", "2847"],
  ["Verify your email for Discord", "Your verification code is 604117", "604117"],
  ["Steam Guard code", "Here is the Steam Guard code you need to login: F7K2Q", "F7K2Q"],
  ["Instagram", "123 456 is your Instagram code. Don't share it.", "123456"],
  ["Confirme seu e-mail", "Digite o código 909-112 para confirmar.", "909112"],
  ["Amazon: OTP", "Your one-time password is 448190. Do not share it.", "448190"],
  ["GitHub launch code", "Here is your GitHub launch code: 77221483", "77221483"],
  ["Código 2024 de verificação", "Seu código de verificação é 551203.", "551203"],
  ["Login", "Code:123456", "123456"],
  ["Seu código", "Seu código é 4829. Protocolo 123456 do atendimento.", "4829"],
  ["Verification", "Your code is a1b2c3", "a1b2c3"],
  // não é código
  ["Pedido confirmado", "Seu pedido 483920 foi confirmado.", null],
  ["Acesse a oferta", "Use o cupom NATAL25 até domingo.", null],
  ["Seu pedido #48213 foi enviado", "Chega amanhã. Total R$ 129,90.", null],
  ["Newsletter de novembro", "As novidades de 2026 chegaram. Veja 5 dicas.", null],
  ["Fatura de novembro", "Valor R$ 482913 vence dia 10.", null],
  ["Reunião amanhã", "Te vejo às 14:30 na sala 204.", null],
];

for (const [title, summary, want] of CASES) {
  test(`extractCode: ${title}`, () => assert.equal(extractCode(title, summary), want));
}

test("baseDomain: .com.br e subdomínio", () => {
  assert.equal(baseDomain("accounts.google.com"), "google.com");
  assert.equal(baseDomain("app.nubank.com.br"), "nubank.com.br");
  assert.equal(baseDomain("www.ifood.com.br"), "ifood.com.br");
  assert.equal(baseDomain("localhost"), "localhost");
});

test("sameSite: mesma empresa e famílias", () => {
  assert.ok(sameSite("no-reply@accounts.google.com", "www.youtube.com"));
  assert.ok(sameSite("noreply@spotify.com", "accounts.spotify.com"));
  assert.ok(sameSite("todomundo@nubank.com.br", "app.nubank.com.br"));
  assert.ok(sameSite("security-noreply@accountprotection.microsoft.com", "login.microsoftonline.com"));
  assert.ok(sameSite("security@mail.instagram.com", "www.instagram.com"));
});

test("sameSite: remetente diferente não bate (site falso)", () => {
  assert.ok(!sameSite("no-reply@accounts.google.com", "g00gle-login.com"));
  assert.ok(!sameSite("noreply@spotify.com", "www.youtube.com"));
  assert.ok(!sameSite("noreply@nubank.com.br", "nubank.com.br.evil.io"));
  assert.ok(!sameSite("sem-arroba", "google.com"));
  // e-mail pessoal não passa por empresa: qualquer um cria conta no Gmail
  assert.ok(!sameSite("golpista@gmail.com", "accounts.google.com"));
  assert.ok(!sameSite("golpista@outlook.com", "login.microsoftonline.com"));
});

test("decode: entidade fora do Unicode não derruba a leitura", () => {
  assert.equal(decode("a&#99999999;b &#233;"), "a&#99999999;b é");
});

test("senderLabel: tira caractere invisível de direção", () => {
  assert.equal(senderLabel({ name: "‮elgooG", email: "x@evil.io" }), "elgooG");
  assert.equal(senderLabel({ name: "", email: "no-reply@spotify.com" }), "spotify.com");
});

const FEED = `<?xml version="1.0" encoding="UTF-8"?><feed version="0.3" xmlns="http://purl.org/atom/ns#">
<title>Gmail - Inbox</title><fullcount>2</fullcount>
<entry><title>Seu c&#243;digo &amp; acesso</title><summary>Use 482913 para entrar</summary>
<issued>2026-11-20T15:00:00Z</issued><id>tag:gmail.google.com,2004:1</id>
<author><name>YouTube</name><email>no-reply@youtube.com</email></author></entry>
<entry><title>Oi</title><summary>tudo bem?</summary><modified>2026-11-20T14:00:00Z</modified>
<id>tag:gmail.google.com,2004:2</id><author><name>Ana</name><email>Ana@Gmail.com</email></author></entry>
</feed>`;

test("parseFeed: lê entradas, decodifica entidades e data", () => {
  const [a, b] = parseFeed(FEED);
  assert.equal(a.title, "Seu código & acesso");
  assert.equal(a.issued, Date.parse("2026-11-20T15:00:00Z"));
  assert.equal(a.email, "no-reply@youtube.com");
  assert.equal(b.email, "ana@gmail.com");
  assert.equal(b.issued, Date.parse("2026-11-20T14:00:00Z"));
  assert.equal(senderLabel(a), "YouTube");
});

test("parseFeed: página de login não é feed", () => {
  assert.equal(parseFeed("<!doctype html><html><body>Fazer login</body></html>"), null);
});
