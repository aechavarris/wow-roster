"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    $WowheadPower?: { refreshLinks: () => void };
  }
}

/** Wowhead only scans links on page load; client navigation needs an explicit refresh. */
export function WowheadRefresh({ deps = [] }: { deps?: unknown[] }) {
  useEffect(() => {
    const timer = window.setTimeout(() => window.$WowheadPower?.refreshLinks(), 50);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass the values that change the links.
  }, deps);
  return null;
}
