import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Cinzel, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { ActionFeedback } from "@/components/ActionFeedback";
import { Header } from "@/components/Header";
import { routing } from "@/i18n/routing";
import { getConfig, getMe } from "@/lib/api";
import "../globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const cinzel = Cinzel({ subsets: ["latin"], variable: "--font-cinzel" });

export async function generateMetadata({ params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  return { title: { default: t("name"), template: `%s · ${t("name")}` }, description: t("tagline") };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [config, me] = await Promise.all([getConfig(), getMe()]);

  return (
    <html lang={locale} className={`${inter.variable} ${cinzel.variable}`}>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider>
          <Header user={me.user} loginEnabled={config.loginEnabled} />
          <main className="mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
          <ActionFeedback />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
