// G-Colou · criado por Vitor Macedo (https://vitormacedobr.vercel.app) · licença MIT
// Roda em toda página: pede ao service worker para ler o Gmail e mostra o card com o código.
(() => {
  if (window.top !== window) return; // só na página principal, não em iframes

  const FAST = 2000; // página com campo de código
  const SLOW = 10000; // resto do tempo
  const FAST_FOR = 3 * 60 * 1000; // modo rápido dura 3 min: a página não prende a extensão lendo o Gmail sem parar
  const SHOW_FOR = 2 * 60 * 1000;
  const W = 320; // largura do card aberto, para não sair da tela

  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs) || key;

  const OTP_HINT = /otp|one.?time|c[óo]digo|code|verif|\bpin\b|token|2fa|mfa/i;
  const NOT_OTP = /zip|post|promo|coupon|cupom|voucher|country|phone|tel|search|busca/i; // "zipcode", "promo_code"...
  const textInputs = () =>
    [...document.querySelectorAll("input:not([type=hidden]):not([type=password]):not([type=email]):not([disabled])")].filter(
      (i) => i.getClientRects().length > 0, // só campo visível (inclui modal fixo)
    );
  // código em caixinhas: o maior grupo de campos de 1 caractere sob o mesmo "avô" no DOM
  const boxes = () => {
    const groups = new Map();
    for (const i of textInputs()) {
      if (i.maxLength !== 1) continue;
      const key = i.parentElement?.parentElement;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    }
    return [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  };
  const isOtp = (i) => {
    if (i.autocomplete === "one-time-code") return true;
    const text = `${i.name} ${i.id} ${i.placeholder} ${i.getAttribute("aria-label") ?? ""}`;
    return i.maxLength !== 1 && OTP_HINT.test(text) && !NOT_OTP.test(text);
  };
  const hasOtpField = () => boxes().length >= 4 || textInputs().some(isOtp);

  // escreve como se fosse digitado: o setter nativo + evento "input" faz React/Vue enxergarem o valor
  const setValue = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  /** Preenche o campo de código da página. Só é chamado por clique e só quando o remetente bate com o site. */
  function fillField(code) {
    const bx = boxes();
    if (bx.length === code.length) {
      [...code].forEach((ch, i) => setValue(bx[i], ch));
      bx.at(-1).focus();
      return true;
    }
    const active = document.activeElement;
    const inputs = textInputs();
    // ordem: campo de código focado, autocomplete="one-time-code", qualquer campo que pareça de código
    const el = active?.matches?.("input") && isOtp(active) ? active : (inputs.find((i) => i.autocomplete === "one-time-code") ?? inputs.find(isOtp));
    if (!el) return false;
    el.focus();
    setValue(el, code);
    return true;
  }

  const shown = new Set(); // o mesmo código chega a cada tick por 2 min: mostra uma vez
  let host = null;
  let box = null;

  // posição salva = fração da tela (0 a 1), para servir em janela de qualquer tamanho
  const place = (pos, side) => {
    const base = "all:initial!important;position:fixed!important;z-index:2147483647!important;";
    if (!pos) return base + `top:16px!important;${side === "left" ? "left" : "right"}:16px!important`;
    const x = Math.round(Math.min(Math.max(pos.x * innerWidth, 0), innerWidth - W));
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

  // Mapa de deslocamento da lente: neutro (cinza) no meio, as bordas entortam o que está atrás, como vidro.
  const LENS_MAP =
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs><linearGradient id="r" x1="0" x2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#f00"/></linearGradient>
        <linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#0f0"/></linearGradient>
        <filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter></defs>
        <rect width="100" height="100" fill="url(#r)"/><rect width="100" height="100" fill="url(#g)" style="mix-blend-mode:screen"/>
        <rect x="6" y="8" width="88" height="84" rx="30" fill="rgb(128,128,0)" filter="url(#b)"/></svg>`,
    );

  function mount({ side, pos }) {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText = place(pos, side);
    const root = host.attachShadow({ mode: "closed" }); // a página não lê o código pelo DOM
    root.innerHTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="gc-lens" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feImage href="${LENS_MAP}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="m"/>
        <feDisplacementMap in="SourceGraphic" in2="m" scale="16" xChannelSelector="R" yChannelSelector="G"/></filter></svg>
      <style>
      :host{--spring:cubic-bezier(.34,1.56,.64,1)}
      .list{display:flex;flex-direction:column;gap:10px}
      .c{position:relative;isolation:isolate;width:236px;box-sizing:border-box;padding:10px 10px 10px 12px;border-radius:30px;color:#fff;cursor:pointer;
        font:600 14px/1.3 "Segoe UI Variable Text","Segoe UI",-apple-system,"SF Pro Text",system-ui,sans-serif;
        text-shadow:0 1px 2px rgba(40,6,14,.35);
        box-shadow:0 18px 40px rgba(60,10,22,.32),0 3px 10px rgba(0,0,0,.18);
        transition:width .45s var(--spring),border-radius .45s var(--spring),transform .2s ease;
        animation:in .55s var(--spring)}
      .c:hover,.c:focus-within,.c.open{width:${W}px;border-radius:24px}
      .c:active{transform:scale(.98)}
      /* camadas do vidro: desfoque (sempre), lente (refração, onde o Chrome suportar), brilho na borda */
      .glass,.lens,.shine{position:absolute;inset:0;border-radius:inherit;pointer-events:none}
      .glass{z-index:-3;background:linear-gradient(135deg,rgba(128,38,54,.82),rgba(80,16,30,.88));
        backdrop-filter:blur(18px) saturate(190%);-webkit-backdrop-filter:blur(18px) saturate(190%)}
      .lens{z-index:-2;backdrop-filter:url(#gc-lens);opacity:.85}
      .shine{z-index:-1;box-shadow:inset 0 1.5px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(255,255,255,.14),inset 0 0 0 1px rgba(255,255,255,.2);
        background:radial-gradient(120% 70% at 20% 0%,rgba(255,255,255,.28),transparent 55%)}
      .c.warn .shine{box-shadow:inset 0 1.5px 0 rgba(255,255,255,.5),inset 0 0 0 2px #ffb020}
      .c:focus-visible{outline:none}.c:focus-visible .shine{box-shadow:inset 0 0 0 2px #fff}
      .row{display:flex;align-items:center;gap:10px}
      .ico{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;
        background:rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.4)}
      .t{flex:1;min-width:0}
      .hi{font-size:11.5px;font-weight:700;opacity:.88;max-height:0;overflow:hidden;transition:max-height .35s var(--spring)}
      .c:hover .hi,.c:focus-within .hi,.c.open .hi{max-height:20px}
      .code{display:block;font:800 22px/1.1 "Cascadia Mono",ui-monospace,"SF Mono",Consolas,monospace;letter-spacing:2.5px;white-space:nowrap}
      .c.link .code{unicode-bidi:isolate;font-family:inherit;font-size:16px;line-height:1.2;letter-spacing:0;overflow:hidden;text-overflow:ellipsis}
      .from{display:block;font-size:12px;font-weight:700;opacity:.92;margin-top:2px;unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .w{display:block;font-size:12px;font-weight:700;color:#ffd27a;margin:8px 4px 0}
      .more{display:grid;grid-template-rows:0fr;transition:grid-template-rows .4s var(--spring)}
      .c:hover .more,.c:focus-within .more,.c.open .more{grid-template-rows:1fr}
      .acts{overflow:hidden;display:flex;gap:8px;padding:0 2px}
      .c:hover .acts,.c:focus-within .acts,.c.open .acts{padding-top:10px}
      .b{flex:1;font-family:inherit;font-size:13px;font-weight:700;line-height:1;color:#fff;border:0;border-radius:999px;padding:9px 12px;cursor:pointer;
        background:rgba(255,255,255,.2);box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 2px 6px rgba(40,6,14,.2)}
      .b:hover{background:rgba(255,255,255,.3)}.b.main{background:#fff;color:#6b1e2b;text-shadow:none}
      .b:focus-visible,.x:focus-visible,.mv:focus-visible{outline:2px solid #fff;outline-offset:2px}
      .side{display:flex;flex-direction:column;gap:2px;align-self:flex-start}
      .x,.mv{min-width:24px;min-height:24px;border-radius:50%;background:none;border:0;color:#fff;opacity:.7;cursor:pointer;
        display:grid;place-items:center;font-size:16px;line-height:1}
      .x:hover,.mv:hover{opacity:1;background:rgba(255,255,255,.18)}
      .mv{cursor:grab;touch-action:none;opacity:0;transition:opacity .2s}.mv:active{cursor:grabbing}
      .c:hover .mv,.c:focus-within .mv,.c.open .mv{opacity:.7}
      .ok .ico{animation:pop .5s var(--spring)}
      @keyframes in{from{opacity:0;transform:translateY(-14px) scale(.9)}}
      @keyframes pop{40%{transform:scale(1.25)}}
      @media (prefers-reduced-motion:reduce){.c,.ok .ico{animation:none;transition:none}.hi,.more{transition:none}}
    </style><div class="list" role="status" aria-live="polite"></div>`;
    box = root.querySelector(".list");
    box.setAttribute("aria-label", t("listLabel"));
    document.documentElement.append(host);
  }

  const ICON = {
    code: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    link: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    ok: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  function show({ id, kind = "code", code, from, match, domain, account, demo }, opts) {
    mount(opts);
    const isLink = kind === "link";
    const name = opts.name?.trim();
    const warn = t("warn", domain || t("otherSite"));
    const canFill = !isLink && !demo && match && hasOtpField(); // preencher só com remetente do próprio site

    const card = document.createElement("div");
    card.className = "c" + (match ? "" : " warn") + (isLink ? " link" : "") + (demo ? " open" : "");
    card.tabIndex = 0;
    card.setAttribute("role", "group"); // grupo: leitor de tela alcança os botões de dentro; Enter no card copia
    card.innerHTML = `<div class="glass"></div><div class="lens"></div><div class="shine"></div>
      <div class="row"><div class="ico" aria-hidden="true"></div>
        <div class="t"><div class="hi"></div><span class="code"></span><span class="from"></span></div>
        <div class="side"><button class="x" type="button">×</button><button class="mv" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/></svg></button></div></div>
      ${match ? "" : '<span class="w"></span>'}
      <div class="more"><div class="acts"></div></div>`;

    // textContent em tudo: nada do e-mail vira HTML
    const $ = (s) => card.querySelector(s);
    const icon = $(".ico");
    icon.innerHTML = ICON[isLink ? "link" : "code"];
    $(".x").setAttribute("aria-label", t("close"));
    $(".mv").setAttribute("aria-label", t("move"));
    $(".hi").textContent = demo ? t("demoHi") : isLink ? (name ? t("hiLinkName", name) : t("hiLink")) : name ? t("hiName", name) : t("hi");
    $(".code").textContent = isLink ? from : code;
    const label = $(".from");
    const fromText = demo ? t("demoFrom") : [isLink ? t("openMail") : t("from", from), account ? t("account", account.split("@")[0]) : ""].filter(Boolean).join(" · ");
    label.textContent = fromText;
    if (!match) $(".w").textContent = warn;
    card.setAttribute("aria-label", (isLink ? `${t("hiLink")}: ${from}` : t("copyLabel", code, from)) + (match ? "" : `. ${warn}`));

    const acts = $(".acts");
    const btn = (text, main, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "b" + (main ? " main" : "");
      b.textContent = text;
      b.addEventListener("click", (e) => (e.stopPropagation(), fn()));
      acts.append(b);
    };

    const used = () => demo || chrome.runtime.sendMessage({ type: "done", id }).catch(() => {});
    const close = () => {
      card.remove();
      if (box && !box.children.length) (host?.remove(), (host = null), (box = null));
    };
    const success = (text) => {
      label.textContent = text;
      card.classList.add("ok", "open");
      icon.innerHTML = ICON.ok;
      used();
      setTimeout(close, 1400);
    };

    let armed = match; // remetente diferente: 1º clique só arma, 2º copia (página não copia por clique escondido)
    const copy = async () => {
      if (demo) return close();
      if (isLink) return openMail();
      if (!armed) {
        armed = true;
        card.classList.add("open");
        label.textContent = t("confirmCopy");
        setTimeout(() => ((armed = false), (label.textContent = fromText)), 4000);
        return;
      }
      try {
        await navigator.clipboard.writeText(code);
        success(t("copied"));
      } catch {
        label.textContent = t("copyFail"); // card fica: o código não se perde
      }
    };
    // o link fica com a extensão: a página só pede "abra o e-mail deste card"
    const openMail = () => {
      chrome.runtime.sendMessage({ type: "open", id }).catch(() => {});
      close();
    };

    if (isLink) btn(t("openMail"), true, openMail);
    else if (!demo) {
      if (canFill) btn(t("fill"), true, () => (fillField(code) ? success(t("filled")) : copy()));
      btn(t("copy"), !canFill, copy);
    }

    $(".mv").addEventListener("pointerdown", drag);
    $(".mv").addEventListener("keydown", nudge);
    card.addEventListener("click", (e) => (e.target.closest(".x") ? (used(), close()) : e.target.closest(".mv") ? null : copy()));
    card.addEventListener("keydown", (e) => {
      if (e.target !== card) return; // Enter no × ou nos botões faz a ação deles, não copia
      if (e.key === "Enter" || e.key === " ") (e.preventDefault(), copy());
    });
    box.prepend(card);
    setTimeout(close, SHOW_FOR);
  }

  // botão "Posicionar" do menu: card de exemplo para arrastar até o lugar padrão
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
