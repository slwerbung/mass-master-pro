import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Stale-deploy recovery: after a new Vercel build, hashed JS chunks referenced
// by an already-open tab may 404, so a lazy import() (e.g. the PDF-Splitter)
// fails with "error loading dynamically imported module". When that happens we
// force a one-time reload to pull the fresh index + chunks. Guarded via
// sessionStorage so a genuinely broken chunk can't cause a reload loop.
const RELOAD_FLAG = "chunk-reload-at";
const looksLikeChunkError = (msg: string) => {
  const m = msg.toLowerCase();
  return (
    m.includes("dynamically imported module") ||
    m.includes("failed to fetch dynamically") ||
    m.includes("error loading dynamically") ||
    m.includes("importing a module script failed") ||
    (m.includes("loading chunk") && m.includes("failed"))
  );
};
const recoverFromStaleChunk = (msg: string) => {
  if (!looksLikeChunkError(msg)) return;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || "0");
    // Only auto-reload once per 15 s, so a chunk that is truly missing (not
    // just stale) surfaces its error instead of reloading forever.
    if (Date.now() - last < 15000) return;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch { /* sessionStorage unavailable → skip the guard, still reload once */ }
  window.location.reload();
};

// Vite fires this when a preloaded dynamic-import chunk fails to load.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  recoverFromStaleChunk(String((e as any)?.payload?.message || "dynamically imported module"));
});
window.addEventListener("unhandledrejection", (e) => {
  recoverFromStaleChunk(String((e as any)?.reason?.message || (e as any)?.reason || ""));
});

const setAppVh = () => {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-vh", `${height * 0.01}px`);
};

setAppVh();
window.addEventListener("resize", setAppVh);
window.addEventListener("orientationchange", setAppVh);
window.visualViewport?.addEventListener("resize", setAppVh);

createRoot(document.getElementById("root")!).render(<App />);
