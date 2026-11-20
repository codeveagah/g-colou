// Cópia automática: service worker não tem área de transferência, este documento invisível tem.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id || msg?.target !== "offscreen" || msg.type !== "copy") return;
  const t = document.getElementById("t");
  t.value = msg.text;
  t.select();
  document.execCommand("copy");
  t.value = "";
});
