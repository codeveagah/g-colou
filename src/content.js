// Roda em toda página: pede ao service worker para ler o Gmail e mostra o card com o código.
(() => {
  if (window.top !== window) return; // só na página principal, não em iframes

  const FAST = 2000; // página com campo de código
  const SLOW = 10000; // resto do tempo
  const FAST_FOR = 3 * 60 * 1000; // modo rápido dura 3 min: a página não prende a extensão lendo o Gmail sem parar
  const SHOW_FOR = 2 * 60 * 1000;

  const OTP_HINT = /otp|one.?time|c[óo]digo|code|verif|\bpin\b|token|2fa|mfa/i;
  const hasOtpField = () =>
    !!document.querySelector('input[autocomplete="one-time-code"]') ||
    document.querySelectorAll('input[maxlength="1"]').length >= 4 || // código em caixinhas
    [...document.querySelectorAll("input:not([type=hidden]):not([type=password]):not([type=email])")].some((i) =>
      OTP_HINT.test(`${i.name} ${i.id} ${i.placeholder} ${i.getAttribute("aria-label") ?? ""}`),
    );

  const shown = new Set(); // o mesmo código chega a cada tick por 2 min: mostra uma vez
  let host = null;
  let box = null;

  // posição salva = fração da tela (0 a 1), para servir em janela de qualquer tamanho
  const place = (pos, side) => {
    const base = "all:initial!important;position:fixed!important;z-index:2147483647!important;";
    if (!pos) return base + `top:16px!important;${side === "left" ? "left" : "right"}:16px!important`;
    const x = Math.round(Math.min(Math.max(pos.x * innerWidth, 0), innerWidth - 300));
    const y = Math.round(Math.min(Math.max(pos.y * innerHeight, 0), innerHeight - 90));
    return base + `left:${x}px!important;top:${y}px!important`;
  };

  // arrastar pela alça: move a lista inteira e grava onde a pessoa soltou
  function drag(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = host.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    let pos = null;
    const move = (ev) => {
      pos = { x: (ev.clientX - dx) / innerWidth, y: (ev.clientY - dy) / innerHeight };
      host.style.cssText = place(pos);
    };
    const up = () => {
      removeEventListener("pointermove", move, true);
      removeEventListener("pointerup", up, true);
      if (pos) chrome.storage.sync.set({ pos }).catch(() => {});
    };
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", up, true);
  }

  // setas do teclado na alça também movem (acessibilidade)
  function nudge(e) {
    const step = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[e.key];
    if (!step) return;
    e.preventDefault();
    const r = host.getBoundingClientRect();
    const pos = { x: (r.left + step[0]) / innerWidth, y: (r.top + step[1]) / innerHeight };
    host.style.cssText = place(pos);
    chrome.storage.sync.set({ pos }).catch(() => {});
  }

  function mount({ side, pos }) {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText = place(pos, side);
    const root = host.attachShadow({ mode: "closed" }); // a página não lê o código pelo DOM
    root.innerHTML = `<style>
      .c{--a:#e8a0a8;--b:#ffffff;font:600 14px/1.35 "Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;position:relative;
        display:flex;align-items:center;gap:12px;margin-bottom:10px;padding:12px 12px 12px 14px;width:300px;box-sizing:border-box;
        border-radius:16px;background:linear-gradient(135deg,rgba(149,62,74,.96),rgba(98,26,39,.96));color:#fff;cursor:pointer;
        backdrop-filter:blur(14px) saturate(160%);-webkit-backdrop-filter:blur(14px) saturate(160%);
        border:1px solid rgba(255,255,255,.16);box-shadow:0 14px 34px rgba(80,15,28,.45),0 2px 6px rgba(0,0,0,.25);
        animation:in .22s cubic-bezier(.2,.9,.3,1.2)}
      .c::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;border-radius:16px 0 0 16px;background:linear-gradient(var(--a),var(--b))}
      .c:hover{background:linear-gradient(135deg,rgba(163,72,85,.97),rgba(110,32,46,.97))}.c:focus-visible{outline:2px solid var(--b);outline-offset:2px}
      .c.warn{border:2px solid #ffb020}.c.warn::before{background:#ffb020}
      .t{flex:1;min-width:0}
      .hi{font-size:12px;font-weight:700;opacity:.85;margin-bottom:2px}
      .code{display:block;font:800 26px/1.1 ui-monospace,"Cascadia Mono","SF Mono",Consolas,monospace;letter-spacing:3px}
      .from{display:block;font-size:12px;font-weight:700;opacity:.9;margin-top:3px;unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .w{display:block;font-size:12px;font-weight:700;color:#ffd27a;margin-top:4px}
      .x{min-width:24px;min-height:24px;border-radius:8px;background:none;border:0;color:#fff;opacity:.55;font-size:18px;cursor:pointer}
      .x:hover,.mv:hover{opacity:1;background:rgba(255,255,255,.08)}
      .btns{display:flex;flex-direction:column;align-self:stretch;justify-content:space-between;gap:4px}
      .mv{min-width:24px;min-height:24px;border-radius:8px;background:none;border:0;color:#fff;opacity:.55;cursor:grab;
        display:grid;place-items:center;touch-action:none}
      .mv:active{cursor:grabbing}.mv:focus-visible,.x:focus-visible{outline:2px solid var(--b)}
      @keyframes in{from{opacity:0;transform:translateY(-8px) scale(.98)}}
      @media (prefers-reduced-motion:reduce){.c{animation:none}}
    </style><div class="list" role="status" aria-live="polite" aria-label="Códigos de verificação"></div>`;
    box = root.querySelector(".list");
    document.documentElement.append(host);
  }

  function show({ id, code, from, match, domain, demo }, opts) {
    mount(opts);
    const warn = `Veio de ${domain || "outro site"}, diferente deste site. Confira antes de usar.`;
    const card = document.createElement("div");
    card.className = "c" + (match ? "" : " warn");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Copiar código ${code} de ${from}${match ? "" : `. ${warn}`}`);
    card.innerHTML = `<div class="t"><div class="hi"></div><span class="code"></span><span class="from"></span>${
      match ? "" : '<span class="w"></span>'
    }</div><div class="btns"><button class="x" aria-label="Fechar">×</button><button class="mv" aria-label="Mover o card (arraste ou use as setas)" title="Arraste para mover"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/></svg></button></div>`;
    const mv = card.querySelector(".mv");
    mv.addEventListener("pointerdown", drag);
    mv.addEventListener("keydown", nudge);
    // textContent em tudo: nada do e-mail vira HTML
    const name = opts.name?.trim();
    card.querySelector(".hi").textContent = demo ? "Exemplo: arraste pelo ✥ até onde quiser" : name ? `${name}, chegou seu código` : "Chegou seu código";
    card.querySelector(".code").textContent = code;
    const label = card.querySelector(".from");
    const fromText = demo ? "solte para salvar · clique para fechar" : `de ${from} · clique para copiar`;
    label.textContent = fromText;
    if (!match) card.querySelector(".w").textContent = warn;

    const used = () => demo || chrome.runtime.sendMessage({ type: "done", id }).catch(() => {});
    const close = () => {
      card.remove();
      if (box && !box.children.length) (host?.remove(), (host = null), (box = null));
    };
    let armed = match; // remetente diferente: 1º clique só arma, 2º copia (página não copia por clique escondido)
    const copy = async () => {
      if (demo) return close();
      if (!armed) {
        armed = true;
        label.textContent = "Clique de novo para copiar mesmo assim";
        setTimeout(() => ((armed = false), (label.textContent = fromText)), 4000);
        return;
      }
      try {
        await navigator.clipboard.writeText(code);
        label.textContent = "Copiado ✓";
        used();
        setTimeout(close, 1500);
      } catch {
        label.textContent = "Não consegui copiar, selecione o código"; // card fica: o código não se perde
      }
    };
    card.addEventListener("click", (e) => (e.target.closest(".x") ? (used(), close()) : e.target.closest(".mv") ? null : copy()));
    card.addEventListener("keydown", (e) => {
      if (e.target !== card) return; // Enter no × fecha, não copia
      if (e.key === "Enter" || e.key === " ") (e.preventDefault(), copy());
    });
    box.prepend(card);
    setTimeout(close, SHOW_FOR);
  }

  // botão "Posicionar na tela" do menu: card de exemplo para arrastar até o lugar padrão
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || msg?.type !== "place") return;
    chrome.storage.sync.get({ side: "right", pos: null, name: "" }).then((opts) =>
      show({ id: "demo", code: "123456", from: "G-Colou", match: true, demo: true }, opts),
    );
  });

  let timer = 0;
  let fastUntil = Date.now() + FAST_FOR;
  async function tick() {
    clearTimeout(timer);
    if (document.visibilityState === "visible") {
      try {
        const { codes = [], opts } = (await chrome.runtime.sendMessage({ type: "tick", wantsCode: hasOtpField() })) ?? {};
        for (const c of codes) if (!shown.has(c.id)) (shown.add(c.id), show(c, opts));
      } catch {
        if (!chrome.runtime?.id) return; // extensão recarregada/removida: para nesta página
      }
    }
    timer = setTimeout(tick, Date.now() < fastUntil && hasOtpField() ? FAST : SLOW);
  }
  const wake = () => ((fastUntil = Date.now() + FAST_FOR), tick());
  // voltou para a aba: confere na hora (o Chrome atrasa timers de aba escondida)
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && wake());
  // pessoa clicou num campo de código (login em etapas): modo rápido na hora
  document.addEventListener("focusin", (e) => e.isTrusted && e.target.matches?.("input") && hasOtpField() && wake());
  tick();
})();
