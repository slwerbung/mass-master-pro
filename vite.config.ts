import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "robots.txt"],
      manifest: {
        name: "Captfix - Aufmaß, Workflows, Kundenportal",
        short_name: "Captfix",
        description: "Captfix - der Operations-Hub für Werbetechnik-Betriebe. Aufmaß erfassen, Projekte verwalten, mit Kunden teilen.",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable"
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        // Default 2 MiB. Our main bundle is currently > 2 MiB because we
        // ship pdf.js + html2canvas + chart libs together. Bumping to 5 MiB
        // lets the service worker precache the full bundle so the app
        // works fully offline. Long-term: code-split via dynamic imports
        // (pdf editor, charts) to bring the entry chunk back under 2 MiB
        // and remove this override.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,jpg,jpeg}"],
        // /mister-x-live is a standalone static page outside the SPA - keep
        // it out of the precache and out of the service worker's navigation
        // fallback so requests to it hit the network/CDN instead of getting
        // redirected to this app's cached index.html.
        globIgnores: ["mister-x-live/**"],
        navigateFallbackDenylist: [/^\/mister-x-live\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
