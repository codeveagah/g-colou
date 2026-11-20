// G-Colou · criado por Vitor Macedo (https://vitormacedobr.vercel.app) · licença MIT
const DEFAULTS = { enabled: true, autoCopy: false, side: "right", name: "", pos: null };
const $ = (id) => document.getElementById(id);
const saved = $("saved");
let hideSaved = 0;

const opts = await chrome.storage.sync.get(DEFAULTS);

async function save(patch) {
  Object.assign(opts, patch);
  await chrome.storage.sync.set(patch);
  render();

// manda a aba aberta mostrar o card de exemplo; o content script só existe em site https
$("place").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "place" });
    window.close(); // fecha o menu para liberar a página
  } catch {
    $("placeHint").textContent = "Abra um site (https://...) nesta aba, recarregue a página e tente de novo.";
  }
});
  saved.textContent = "Salvo ✓";
  clearTimeout(hideSaved);
  hideSaved = setTimeout(() => (saved.textContent = ""), 1200);
}

// prévia ao vivo: mostra exatamente o que vai aparecer na página
function render() {
  const name = opts.name.trim();
  $("pvHi").textContent = name ? `${name}, chegou seu código` : "Chegou seu código";
  $("preview").classList.toggle("left", opts.side === "left");
  $("preview").classList.toggle("off", !opts.enabled);
}

$("enabled").checked = opts.enabled;
$("autoCopy").checked = opts.autoCopy;
$("name").value = opts.name;
document.querySelector(`input[name=side][value=${opts.side === "left" ? "left" : "right"}]`).checked = true;

$("enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
$("autoCopy").addEventListener("change", (e) => save({ autoCopy: e.target.checked }));
for (const r of document.querySelectorAll("input[name=side]")) r.addEventListener("change", (e) => save({ side: e.target.value, pos: null })); // escolher o lado tira a posição arrastada
let typing = 0;
$("name").addEventListener("input", (e) => {
  opts.name = e.target.value;
  render();

// manda a aba aberta mostrar o card de exemplo; o content script só existe em site https
$("place").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "place" });
    window.close(); // fecha o menu para liberar a página
  } catch {
    $("placeHint").textContent = "Abra um site (https://...) nesta aba, recarregue a página e tente de novo.";
  }
});
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
    $("placeHint").textContent = "Abra um site (https://...) nesta aba, recarregue a página e tente de novo.";
  }
});
