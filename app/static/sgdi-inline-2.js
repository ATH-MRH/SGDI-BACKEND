if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(reg => {
      reg.update().catch(() => {});
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
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
