if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(reg => {
      reg.update().catch(() => {});
      const precache = () => {
        const urls = [
          "/",
          "/static/manifest.webmanifest",
          ...Array.from(document.querySelectorAll('link[rel="stylesheet"][href],link[rel="icon"][href],link[rel="apple-touch-icon"][href],script[src],img[src]'))
            .map(el => el.href || el.src)
            .map(src => {
              try {
                const u = new URL(src, location.origin);
                return u.origin === location.origin ? u.pathname + u.search : "";
              } catch (_) { return ""; }
            })
            .filter(Boolean)
        ];
        const sw = reg.active || navigator.serviceWorker.controller;
        if (sw) sw.postMessage({ type: "PRECACHE_URLS", urls });
      };
      if (reg.active) precache();
      else navigator.serviceWorker.ready.then(precache).catch(() => {});
    }).catch(() => {});
  });
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
