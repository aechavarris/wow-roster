/**
 * Wowhead tooltip widget. Loaded on demand so hovering an item link shows Wowhead's full in-game tooltip. The
 * links already point at the right Wowhead domain (via wowheadItemUrl), which the widget reads from each link's
 * path, so items of every game version tooltip correctly. Loading and refreshing are no-ops on the server.
 */

declare global {
  interface Window {
    whTooltips?: { colorLinks: boolean; iconizeLinks: boolean; renameLinks: boolean };
    $WowheadPower?: { refreshLinks: () => void };
  }
}

const SCRIPT_SRC = "https://wow.zamimg.com/js/tooltips.js";
let loaded = false;

/** Injects the Wowhead tooltip widget once. Safe to call repeatedly. */
export function loadWowheadTooltips(): void {
  if (typeof window === "undefined" || loaded) return;
  loaded = true;
  // Config must be set before the script runs; keep links as-is (no recolor/icon/rename) so our styling stays.
  window.whTooltips = { colorLinks: false, iconizeLinks: false, renameLinks: false };
  const script = document.createElement("script");
  script.src = SCRIPT_SRC;
  script.async = true;
  document.head.appendChild(script);
}

/** Re-scans the page for item links after results change, so freshly rendered links get their tooltip. */
export function refreshWowheadLinks(): void {
  if (typeof window !== "undefined") window.$WowheadPower?.refreshLinks();
}
