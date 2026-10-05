"use client";

import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { routing, usePathname, useRouter } from "@/i18n/routing";

export function LocaleSwitcher() {
  const t = useTranslations("app");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  return (
    <select
      aria-label={t("language")}
      className="input w-auto py-1"
      value={locale}
      onChange={(event) =>
        // pathname is the route template; params fill in its dynamic segments.
        router.replace({ pathname, params } as never, { locale: event.target.value })
      }
    >
      {routing.locales.map((l) => (
        <option key={l} value={l}>
          {l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
