// G-Colou · criado por Vitor Macedo (https://vitormacedobr.vercel.app) · licença MIT
// Funções puras: ler o feed do Gmail, achar o código e comparar remetente com o site.
// Service worker não tem DOMParser, então o feed é lido com regex.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// número fora do Unicode faria fromCodePoint lançar e derrubar a leitura do feed
const char = (n, m) => (n <= 0x10ffff ? String.fromCodePoint(n) : m);

export function decode(s) {
  return s
    .replace(/&#(\d+);/g, (m, n) => char(Number(n), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => char(parseInt(n, 16), m))
    .replace(/&(\w+);/g, (m, k) => ENTITIES[k] ?? m);
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : "";
};

/** Feed Atom do Gmail → lista de e-mails. Retorna null se não for um feed (ex.: página de login). */
export function parseFeed(xml) {
  if (!/<feed[\s>]/.test(xml)) return null;
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const author = e.match(/<author>([\s\S]*?)<\/author>/)?.[1] ?? "";
    return {
      id: tag(e, "id"),
      title: tag(e, "title"),
      summary: tag(e, "summary"),
      issued: Date.parse(tag(e, "issued") || tag(e, "modified")) || 0,
      name: tag(author, "name"),
      email: tag(author, "email").toLowerCase(),
      link: gmailLink(decode(e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "")),
    };
  });
}

/** Conta dona do feed: "Gmail - Inbox for ana@gmail.com" → "ana@gmail.com". */
export function feedAccount(xml) {
  const head = xml.split("<entry>")[0]; // título do feed, nunca o assunto de um e-mail
  return (head.match(/<title>[^<]*?([\w.+-]+@[\w.-]+)<\/title>/)?.[1] ?? "").toLowerCase();
}

/** Só aceita link do próprio Gmail (o feed traz http://; vira https://). Qualquer outro vira "". */
export function gmailLink(href) {
  try {
    const u = new URL(href);
    if (u.hostname !== "mail.google.com" || !/^https?:$/.test(u.protocol)) return "";
    u.protocol = "https:";
    return u.href;
  } catch {
    return "";
  }
}

// e-mail de "entrar sem senha": o feed não traz o link de dentro do e-mail, então o card abre o e-mail
const MAGIC =
  /link (de |para )?(acesso|login|entrar)|magic link|sign[- ]?in link|log[- ]?in link|clique (aqui )?para (entrar|acessar|fazer login|confirmar)|click (here |below )?to (sign|log) ?in|confirm (your )?(e-?mail|sign[- ]?in)|confirme (seu )?e-?mail/i;

export const isMagicLink = (title, summary) => MAGIC.test(`${title} \n ${summary}`);

// Só procura código perto destas palavras; evita pegar nº de pedido, cupom e protocolo.
const KEYWORD =
  /c[óo]digo|\bcode\b|verifica|verify|\botp\b|\bpin\b|token|senha (tempor[áa]ria|[úu]nica)|one[- ]time|autentica|2fa|steam guard/gi;
const NEAR = 60; // caracteres entre a palavra-chave e o código

const YEAR = /^(19|20)\d{2}$/;

/** Acha o código de verificação no assunto + prévia. Retorna null se não tiver. */
export function extractCode(title, summary) {
  const text = `${title} \n ${summary}`;
  const kw = [...text.matchAll(KEYWORD)].map((k) => k.index);
  if (!kw.length) return null;
  const found = [];
  // "123 456" e "123-456" viram um código só; "-" antes é aceito por causa do "G-482913" do Google
  const re = /(?<![\w$#.,/-])(\d{3})[ -](\d{3})(?![\w%/:-]|[.,]\d)|(?<![\w$#.,/@])([A-Za-z0-9]{4,8})(?![\w%@/:-]|[.,]\d)/g;
  for (const m of text.matchAll(re)) {
    const code = m[3] ?? m[1] + m[2];
    if (!/\d/.test(code)) continue; // palavra comum (ex.: "GOOGLE")
    if (/^\d{4}$/.test(code) && YEAR.test(code)) continue;
    const before = text.slice(Math.max(0, m.index - 4), m.index);
    if (/R\$\s?$|US\$\s?$|nº\s?$|#\s?$/i.test(before)) continue;
    const dist = Math.min(...kw.map((i) => Math.abs(i - m.index)));
    if (dist <= NEAR) found.push({ code, dist, digits: /^\d+$/.test(code) });
  }
  if (!found.length) return null;
  // o mais perto da palavra-chave vence; empate: só números
  found.sort((a, b) => a.dist - b.dist || b.digits - a.digits);
  return found[0].code;
}

// sufixos de dois níveis comuns (ex.: nubank.com.br)
const SECOND_LEVEL = new Set(["com", "net", "org", "gov", "edu", "co", "ac", "ne", "or"]);

// hospedagem compartilhada: cada subdomínio é de um dono diferente (evil.firebaseapp.com ≠ vitima.firebaseapp.com)
const SHARED = new Set([
  "firebaseapp.com", "web.app", "appspot.com", "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev",
  "workers.dev", "herokuapp.com", "onrender.com", "fly.dev", "glitch.me", "repl.co", "surge.sh", "ngrok.io",
  "ngrok-free.app", "azurewebsites.net", "cloudfront.net", "amazonaws.com", "blogspot.com", "wordpress.com",
  "weebly.com", "wixsite.com", "carrd.co", "itch.io", "tumblr.com", "notion.site",
]);

export function baseDomain(host) {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length > 2 && SHARED.has(parts.slice(-2).join("."))) return parts.slice(-3).join(".");
  if (parts.length > 2 && parts.at(-1).length === 2 && SECOND_LEVEL.has(parts.at(-2))) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

// empresas que mandam e-mail de um domínio e atendem em outro.
// Nunca pôr domínio de e-mail pessoal (gmail.com, outlook.com, live.com): qualquer um cria conta lá.
const FAMILY = {
  "youtube.com": "google.com",
  "instagram.com": "facebookmail.com",
  "facebook.com": "facebookmail.com",
  "whatsapp.com": "facebookmail.com",
  "microsoftonline.com": "microsoft.com",
  "office.com": "microsoft.com",
  "xbox.com": "microsoft.com",
  "steamcommunity.com": "steampowered.com",
};
const family = (d) => FAMILY[d] ?? d;

/** O e-mail veio da mesma empresa do site aberto? */
export function sameSite(senderEmail, pageHost) {
  const d = senderDomain(senderEmail);
  if (!d || !pageHost) return false;
  return family(d) === family(baseDomain(pageHost));
}

/** Domínio de quem mandou: "spotify.com". */
export function senderDomain(email) {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : baseDomain(email.slice(at + 1).replace(/\p{Cf}/gu, ""));
}

/** Nome curto do remetente para o card: "YouTube", "Spotify". */
export function senderLabel(entry) {
  // \p{Cf} tira caracteres invisíveis de direção (RLO), que viram "Google" de trás para frente
  const name = entry.name.replace(/\p{Cf}/gu, "").replace(/\s*(<.*>|\(.*\))\s*$/, "").trim();
  return name ? name.slice(0, 40) : senderDomain(entry.email) || "E-mail";
}
