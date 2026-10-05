import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // A shared reference time keeps relative dates identical on the server and during hydration.
    now: new Date(),
    timeZone: process.env.APP_TIME_ZONE ?? "Europe/Madrid",
  };
});
