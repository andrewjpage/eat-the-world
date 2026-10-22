import { mergeConfig, type Plugin } from "vite";
import soloConfig from "../../../solo/vite.config";

/**
 * The app's own build config with one trivial, visible change: a line of text, named by
 * `ETW_BUILD_MARKER`, added to the entry script. update.spec.ts builds it twice with different
 * markers to stand in for "the next release", without touching the source.
 */
function buildMarker(text: string): Plugin {
  const script = `
const marker = document.createElement("p");
marker.id = "build-marker";
marker.textContent = ${JSON.stringify(text)};
marker.style.cssText = "position:fixed;top:0;left:0;z-index:9999;margin:0;font:10px monospace";
document.body.append(marker);
`;
  return {
    name: "update-spec-build-marker",
    transform(code, id) {
      return id.endsWith("/solo/src/main.tsx") ? `${code}\n${script}` : null;
    },
  };
}

export default mergeConfig(soloConfig, { plugins: [buildMarker(process.env.ETW_BUILD_MARKER ?? "build")] });
