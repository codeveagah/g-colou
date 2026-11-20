// G-Colou · criado por Vitor Macedo (https://vitormacedobr.vercel.app) · licença MIT
const DEFAULTS = { enabled: true, autoCopy: false, side: "right", name: "", pos: null, allAccounts: true };
const $ = (id) => document.getElementById(id);
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs) || key;
const saved = $("saved");
let hideSaved = 0;

// textos no idioma do Chrome (pt_BR ou en)
document.documentElement.lang = chrome.i18n.getUILanguage();
for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
for (const el of document.querySelectorAll("[data-i18n-ph]")) el.placeholder = t(el.dataset.i18nPh);
for (const el of document.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
for (const el of document.querySelectorAll("[data-i18n-label]")) el.setAttribute("aria-label", t(el.dataset.i18nLabel));

const opts = await chrome.storage.sync.get(DEFAULTS);

async function save(patch) {
  Object.assign(opts, patch);
  await chrome.storage.sync.set(patch);
  render();
  saved.textContent = t("optSaved");
  clearTimeout(hideSaved);
  hideSaved = setTimeout(() => (saved.textContent = ""), 1200);
}

// prévia ao vivo: mostra exatamente o que vai aparecer na página
function render() {
  const name = opts.name.trim();
  $("pvHi").textContent = name ? t("hiName", name) : t("hi");
  $("pvFrom").textContent = t("from", "YouTube");
  $("stage").classList.toggle("right", opts.side !== "left");
  $("stage").classList.toggle("off", !opts.enabled);
}

for (const k of ["enabled", "autoCopy", "allAccounts"]) {
  $(k).checked = opts[k];
  $(k).addEventListener("change", (e) => save({ [k]: e.target.checked }));
}
$("name").value = opts.name;
document.querySelector(`input[name=side][value=${opts.side === "left" ? "left" : "right"}]`).checked = true;
// escolher o lado tira a posição arrastada
for (const r of document.querySelectorAll("input[name=side]")) r.addEventListener("change", (e) => save({ side: e.target.value, pos: null }));
let typing = 0;
$("name").addEventListener("input", (e) => {
  opts.name = e.target.value;
  render();
  clearTimeout(typing); // grava depois que a pessoa para de digitar (limite de escrita do storage.sync)
  typing = setTimeout(() => save({ name: e.target.value.trim().slice(0, 24) }), 500);
});
render();

// manda a aba aberta mostrar o card de exemplo; o content script só existe em site https
$("place").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "place" });
    window.close(); // fecha o menu para liberar a página
  } catch {
    $("placeHint").textContent = t("optPlaceErr");
  }
});
