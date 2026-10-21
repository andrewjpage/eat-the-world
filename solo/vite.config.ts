import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
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

export default defineConfig({
  root: here("."),
  // Relative asset URLs, so the build works under any path (GitHub Pages serves it at /eat-the-world/).
  base: "./",
  plugins: [react(), tailwindcss(), appConstants()],
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
