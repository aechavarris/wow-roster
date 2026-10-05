"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";

export function AcceptInviteButton({ token }: { token: string }) {
  const t = useTranslations("invite");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const { guildId } = await apiSend<{ guildId: string }>("POST", `/invites/${encodeURIComponent(token)}/accept`);
            router.push(`/guild/${guildId}`);
          } catch (err) {
            setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
            setPending(false);
          }
        }}
      >
        {pending ? t("joining") : t("accept")}
      </button>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
