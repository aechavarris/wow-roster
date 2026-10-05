"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { apiSend } from "@/lib/client-api";

export function SyncGuildButton({ guildId }: { guildId: string }) {
  const t = useTranslations("guild");
  const [state, setState] = useState<"idle" | "pending" | "queued" | "error">("idle");
  return (
    <button
      type="button"
      className="btn"
      disabled={state === "pending" || state === "queued"}
      onClick={async () => {
        setState("pending");
        try {
          await apiSend("POST", `/guilds/${guildId}/sync`);
          setState("queued");
        } catch {
          setState("error");
        }
      }}
    >
      {state === "queued" ? t("syncQueued") : state === "error" ? t("syncFailed") : t("syncNow")}
    </button>
  );
}
