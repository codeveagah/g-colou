import { parseFeed, extractCode, sameSite, senderLabel, senderDomain } from "./lib.js";

// Lê o feed do Gmail com o login que a pessoa já tem no Chrome. Nada sai do navegador.
const FEED = "https://mail.google.com/mail/u/0/feed/atom";
const MAX_AGE = 5 * 60 * 1000; // só e-mail dos últimos 5 min (código mais velho que isso já costuma ter vencido)
const KEEP = 2 * 60 * 1000; // código fica disponível para as abas por 2 min
const MIN_GAP = 1800; // várias abas pedindo ao mesmo tempo = uma leitura só
const BACKOFF = 30 * 1000; // Gmail respondeu erro: espera antes de tentar de novo

const DEFAULTS = { enabled: true, autoCopy: false, side: "right", name: "", pos: null };

let nextFetch = 0;
let inflight = null;

/** Atualiza a lista de códigos recentes (no máximo uma leitura a cada MIN_GAP). */
function refresh() {
  if (inflight || Date.now() < nextFetch) return inflight;
  nextFetch = Date.now() + MIN_GAP;
  inflight = readFeed()
    .catch(() => (nextFetch = Date.now() + BACKOFF))
    .finally(() => (inflight = null));
  return inflight;
}

async function readFeed() {
  const r = await fetch(FEED, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(`gmail ${r.status}`); // 429/5xx: erro passageiro, não é falta de login
  const entries = parseFeed(await r.text());
  await chrome.action.setBadgeText({ text: entries ? "" : "!" });
  await chrome.action.setTitle({ title: entries ? "G-Colou" : "G-Colou: entre no Gmail neste Chrome" });
  if (!entries) return;

  // ids já vistos ficam no armazenamento local (sobrevivem a recarregar a extensão, senão e-mail velho volta);
  // o código em si fica só na memória da sessão
  const { seen = [] } = await chrome.storage.local.get("seen");
  const { recent = [] } = await chrome.storage.session.get("recent");
  const now = Date.now();
  for (const e of entries) {
    if (!e.id || seen.includes(e.id) || now - e.issued > MAX_AGE) continue;
    seen.push(e.id);
    const code = extractCode(e.title, e.summary);
    if (code) recent.push({ id: e.id, code, from: senderLabel(e), email: e.email, until: now + KEEP });
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
  await refresh();
  const { recent = [] } = await chrome.storage.session.get("recent");
  const { copied = [], done = [], shownIds = [] } = await chrome.storage.local.get(["copied", "done", "shownIds"]);
  const host = pageUrl ? new URL(pageUrl).hostname : "";
  const now = Date.now();
  // código usado (copiado/fechado) não volta; código já mostrado só volta em página que ainda pede código
  const codes = recent
    .filter((c) => c.until > now && !done.includes(c.id) && (wantsCode || !shownIds.includes(c.id)))
    .map((c) => ({ ...c, match: sameSite(c.email, host) }));
  if (codes.length) await chrome.storage.local.set({ shownIds: [...new Set([...shownIds, ...codes.map((c) => c.id)])].slice(-50) });
  // cópia automática só de remetente que bate com o site, uma vez por código
  const auto = opts.autoCopy && codes.find((c) => c.match && !copied.includes(c.id));
  if (auto) {
    await copy(auto.code).catch(() => {});
    await chrome.storage.local.set({ copied: [...copied, auto.id].slice(-50) });
  }
  // remetente fica fora da resposta: a página só recebe código, nome e se bate com o site
  return { codes: codes.map(({ email, until, ...c }) => ({ ...c, domain: c.match ? "" : senderDomain(email) })), opts };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!sender.tab || sender.id !== chrome.runtime.id) return;
  if (msg?.type === "done") {
    // copiou ou fechou o card: código usado, não aparece em mais nenhuma aba
    chrome.storage.local.get("done").then(({ done = [] }) => chrome.storage.local.set({ done: [...done, String(msg.id)].slice(-50) }));
    return;
  }
  if (msg?.type !== "tick") return;
  // sender.url vem do navegador (a página não forja) e não precisa da permissão "tabs"
  onTick(sender.url, !!msg.wantsCode)
    .then(reply)
    .catch(() => reply({ codes: [], opts: DEFAULTS })); // erro aqui nunca para o polling das abas
  return true; // resposta assíncrona
});