import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const setAppVh = () => {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-vh", `${height * 0.01}px`);
};

setAppVh();
window.addEventListener("resize", setAppVh);
window.addEventListener("orientationchange", setAppVh);
window.visualViewport?.addEventListener("resize", setAppVh);

createRoot(document.getElementById("root")!).render(<App />);
