// G-Colou · criado por Vitor Macedo (https://vitormacedobr.vercel.app) · licença MIT
import { parseFeed, extractCode, sameSite, senderLabel, senderDomain, feedAccount, isMagicLink } from "./lib.js";

// Lê o feed do Gmail com o login que a pessoa já tem no Chrome. Nada sai do navegador.
const feedUrl = (u) => `https://mail.google.com/mail/u/${u}/feed/atom`;
const MAX_ACCOUNTS = 5; // /u/0 a /u/4
const DISCOVER_EVERY = 10 * 60 * 1000; // procura contas novas a cada 10 min
const MAX_AGE = 5 * 60 * 1000; // só e-mail dos últimos 5 min (código mais velho que isso já costuma ter vencido)
const KEEP = 2 * 60 * 1000; // código fica disponível para as abas por 2 min
const MIN_GAP = 1800; // várias abas pedindo ao mesmo tempo = uma leitura só
const BACKOFF = 30 * 1000; // Gmail respondeu erro: espera antes de tentar de novo

const DEFAULTS = { enabled: true, autoCopy: false, side: "right", name: "", pos: null, allAccounts: true };

let nextFetch = 0;
let inflight = null;
let accounts = null; // [{ u: 0, email: "ana@gmail.com" }]
let discoveredAt = 0;

async function getFeed(u) {
  const r = await fetch(feedUrl(u), { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(`gmail ${r.status}`); // 429/5xx: erro passageiro, não é falta de login
  return r.text();
}

/** Quais contas do Gmail estão logadas neste Chrome. /u/N que não existe devolve outra conta ou login: para ali. */
async function discover() {
  const found = [];
  let failed = false;
  for (let u = 0; u < MAX_ACCOUNTS; u++) {
    let xml;
    try {
      xml = await getFeed(u);
    } catch {
      failed = true; // erro passageiro: não conclui que a conta não existe
      break;
    }
    const email = parseFeed(xml) ? feedAccount(xml) : "";
    if (!email || found.some((a) => a.email === email)) break;
    found.push({ u, email });
  }
  if (failed && !found.length) throw new Error("gmail fora"); // nada gravado: tenta de novo no próximo ciclo
  accounts = found;
  discoveredAt = failed ? Date.now() - DISCOVER_EVERY + 60 * 1000 : Date.now(); // com falha, procura de novo em 1 min
}

/** Atualiza a lista de códigos recentes (no máximo uma leitura a cada MIN_GAP). */
function refresh(all) {
  if (inflight || Date.now() < nextFetch) return inflight;
  nextFetch = Date.now() + MIN_GAP;
  inflight = readFeeds(all)
    .catch(() => (nextFetch = Date.now() + BACKOFF))
    .finally(() => (inflight = null));
  return inflight;
}

async function readFeeds(all) {
  if (all && (!accounts || Date.now() - discoveredAt > DISCOVER_EVERY)) await discover();
  const list = all && accounts?.length ? accounts : [{ u: 0, email: "" }];
  const read = await Promise.allSettled(list.map((a) => getFeed(a.u)));
  if (read.every((r) => r.status === "rejected")) throw new Error("gmail fora");
  const feeds = list.map((a, i) => {
    const xml = read[i].status === "fulfilled" ? read[i].value : ""; // uma conta com erro não derruba as outras
    const owner = xml && feedAccount(xml);
    // saiu de uma conta: /u/N passa a ser outra pessoa; ignora e redescobre
    if (a.email && owner && owner !== a.email) return (accounts = null), { a, entries: null };
    return { a, entries: parseFeed(xml) };
  });

  const loggedIn = feeds.some((f) => f.entries);
  await chrome.action.setBadgeText({ text: loggedIn ? "" : "!" });
  await chrome.action.setTitle({ title: chrome.i18n.getMessage(loggedIn ? "extName" : "badgeLogin") });
  if (!loggedIn) return;

  // ids já vistos ficam no armazenamento local (sobrevivem a recarregar a extensão, senão e-mail velho volta);
  // o código e o link ficam só na memória da sessão
  const { seen = [] } = await chrome.storage.local.get("seen");
  const { recent = [] } = await chrome.storage.session.get("recent");
  const now = Date.now();
  for (const { a, entries } of feeds) {
    for (const e of entries ?? []) {
      const id = e.id; // id do Gmail já é único: não muda ao ligar/desligar contas
      if (!e.id || seen.includes(id) || now - e.issued > MAX_AGE) continue;
      seen.push(id);
      const base = { id, from: senderLabel(e), email: e.email, account: list.length > 1 ? a.email : "", until: now + KEEP };
      const code = extractCode(e.title, e.summary);
      if (code) recent.push({ ...base, kind: "code", code });
      else if (e.link && isMagicLink(e.title, e.summary)) recent.push({ ...base, kind: "link", link: e.link });
    }
  }
  await chrome.storage.local.set({ seen: seen.slice(-300) });
  await chrome.storage.session.set({ recent: recent.filter((c) => c.until > now) });
}

async function copy(text) {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "src/offscreen.html",
      reasons: ["CLIPBOARD"],
      justification: "Copiar o código quando a opção de cópia automática está ligada.",
    });
  }
  await chrome.runtime.sendMessage({ type: "copy", text, target: "offscreen" });
}

async function onTick(pageUrl, wantsCode) {
  const opts = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  if (!opts.enabled) return { codes: [], opts };
  await refresh(opts.allAccounts);
  const { recent = [] } = await chrome.storage.session.get("recent");
  const { copied = [], done = [], shownIds = [] } = await chrome.storage.local.get(["copied", "done", "shownIds"]);
  const host = pageUrl ? new URL(pageUrl).hostname : "";
  const now = Date.now();
  // usado (copiado/aberto/fechado) não volta; já mostrado só volta em página que ainda pede código
  const codes = recent
    .filter((c) => c.until > now && !done.includes(c.id) && (wantsCode || !shownIds.includes(c.id)))
    .map((c) => ({ ...c, match: sameSite(c.email, host) }));
  if (codes.length) await chrome.storage.local.set({ shownIds: [...new Set([...shownIds, ...codes.map((c) => c.id)])].slice(-50) });
  // cópia automática só de código cujo remetente bate com o site, uma vez por código
  const auto = opts.autoCopy && codes.find((c) => c.kind === "code" && c.match && !copied.includes(c.id));
  if (auto) {
    await copy(auto.code).catch(() => {});
    await chrome.storage.local.set({ copied: [...copied, auto.id].slice(-50) });
  }
  // a página não recebe o e-mail do remetente nem o link: só o que o card mostra
  return {
    codes: codes.map(({ email, until, link, ...c }) => ({ ...c, domain: c.match ? "" : senderDomain(email) })),
    opts,
  };
}

async function markDone(id) {
  const { done = [] } = await chrome.storage.local.get("done");
  await chrome.storage.local.set({ done: [...done, String(id)].slice(-50) });
}

/** "Abrir e-mail" do card de link mágico: o link vem da memória da extensão, nunca da página. */
async function openMail(id, tab) {
  const { recent = [] } = await chrome.storage.session.get("recent");
  const item = recent.find((c) => c.id === id && c.kind === "link");
  if (!item) return;
  await chrome.tabs.create({ url: item.link, index: tab.index + 1, openerTabId: tab.id });
  await markDone(id);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!sender.tab || sender.id !== chrome.runtime.id) return;
  if (msg?.type === "done") return void markDone(msg.id);
  if (msg?.type === "open") return void openMail(String(msg.id), sender.tab);
  if (msg?.type !== "tick") return;
  // sender.url vem do navegador (a página não forja) e não precisa da permissão "tabs"
  onTick(sender.url, !!msg.wantsCode)
    .then(reply)
    .catch(() => reply({ codes: [], opts: DEFAULTS })); // erro aqui nunca para o polling das abas
  return true; // resposta assíncrona
});
