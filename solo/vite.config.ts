import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { APP_NAME, THEME_DARK, THEME_LIGHT } from "../src/lib/app";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Fills the `%…%` placeholders in index.html from the group app's constants. */
function appConstants(): Plugin {
  const values: Record<string, string> = { APP_NAME, THEME_LIGHT, THEME_DARK };
  return {
    name: "solo-app-constants",
    transformIndexHtml: (html) => html.replace(/%(APP_NAME|THEME_LIGHT|THEME_DARK)%/g, (_, key) => values[key]),
  };
}

/**
 * The offline app: a web manifest for "Add to Home screen" and a Workbox service worker that precaches
 * the whole build, so everything but the map tiles works with no connection after one visit.
 *
 * - There are no runtime caching rules. OpenStreetMap's tile policy forbids prefetching or storing tiles
 *   for offline use, so the worker never answers a tile request.
 * - `skipWaiting` and `clientsClaim` make an update take over at once. The worker only ever replaces the
 *   cached app files: the visits live in IndexedDB, which nothing here touches.
 * - Every address is relative (`start_url`, `scope`, the icons, the worker itself), because GitHub Pages
 *   serves the app from /eat-the-world/. The `id` is the exception: it names the app, and is resolved
 *   against the origin (`/eat-the-world-solo`), so it stays the same if the app moves to another folder.
 */
function offlineApp() {
  return VitePWA({
    registerType: "autoUpdate",
    // Registered by src/pwa.ts, in the production build only.
    injectRegister: false,
    manifest: {
      id: "/eat-the-world-solo",
      name: `${APP_NAME} Solo`,
      short_name: "ETW Solo",
      description: "Log the meals that stamp your passport. It works offline, and your visits stay on this phone.",
      lang: "en-GB",
      start_url: "./",
      scope: "./",
      display: "standalone",
      orientation: "portrait",
      background_color: THEME_LIGHT,
      theme_color: THEME_LIGHT,
      icons: [
        { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    workbox: {
      // Scripts, styles and the page, plus the flags (SVG) and fonts (.woff2) the styles ask for. The
      // .woff copies are left out: each @font-face lists .woff2 first, and every browser that runs a
      // service worker supports it. The icons and the manifest are added by the plugin.
      globPatterns: ["**/*.{js,css,html,svg,woff2}"],
      navigateFallback: "index.html",
      skipWaiting: true,
      clientsClaim: true,
    },
  });
}

export default defineConfig({
  root: here("."),
  // Relative asset URLs, so the build works under any path (GitHub Pages serves it at /eat-the-world/).
  base: "./",
  plugins: [react(), tailwindcss(), appConstants(), offlineApp()],
  resolve: {
    alias: {
      "@solo": here("./src"),
      "@": here("../src"),
      "next/link": here("./src/shims/link.tsx"),
      "next/navigation": here("./src/shims/navigation.ts"),
      "next/dynamic": here("./src/shims/dynamic.tsx"),
    },
  },
  // Shared code, fonts and flags live above the `solo` root.
  server: { fs: { allow: [".."] } },
});
