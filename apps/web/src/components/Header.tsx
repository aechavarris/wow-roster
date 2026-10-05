import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { LoginButton, LogoutButton } from "./AuthButtons";

interface Props {
  user: { battletag: string } | null;
  loginEnabled: boolean;
  profileLabel: string;
}

export function Header({ user, loginEnabled, profileLabel }: Props) {
  const t = useTranslations("app");
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="heading text-lg text-accent no-underline">
          {t("name")}
        </Link>
        <span className="hidden text-xs text-muted sm:inline" title={t("gameProfile")}>
          {profileLabel}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <LocaleSwitcher />
          {user ? (
            <>
              <span className="text-sm text-muted">{user.battletag}</span>
              <LogoutButton />
            </>
          ) : loginEnabled ? (
            <LoginButton />
          ) : null}
        </div>
      </div>
    </header>
  );
}
