"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";

export function RefreshCharacterButton({ characterId }: { characterId: string }) {
  const t = useTranslations("character");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-1">
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await apiSend("POST", `/characters/${characterId}/sync`);
            router.refresh();
          } catch (err) {
            setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? t("refreshing") : t("refresh")}
      </button>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
