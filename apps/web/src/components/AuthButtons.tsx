"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import { apiSend } from "@/lib/client-api";

export function LoginButton({ className = "btn btn-primary" }: { className?: string }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const pathname = usePathname();
  const redirect = encodeURIComponent(`/${locale}${pathname === "/" ? "" : pathname}`);
  // A plain link: the API answers with a redirect to Battle.net.
  return (
    <a href={`/api/auth/login?redirect=${redirect}`} className={className}>
      {t("login")}
    </a>
  );
}

export function LogoutButton() {
  const t = useTranslations("auth");
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        await apiSend("POST", "/auth/logout", undefined, { quiet: true });
        router.refresh();
      }}
    >
      {t("logout")}
    </button>
  );
}
