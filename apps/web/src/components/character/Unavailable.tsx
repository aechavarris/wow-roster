import { useTranslations } from "next-intl";

/** Shown when the game version's API lacks an endpoint or the request failed. */
export function Unavailable({ reason }: { reason?: string }) {
  const t = useTranslations("character");
  return <p className="text-sm text-muted">{reason === "unsupported" ? t("unsupported") : t("unavailable")}</p>;
}
