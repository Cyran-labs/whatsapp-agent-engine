import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = routing.locales.includes(requested as 'fr' | 'en')
    ? (requested as 'fr' | 'en')
    : routing.defaultLocale;
  return {
    locale,
    // Les dates s'affichent en heure de Paris, quel que soit le fuseau du serveur ou du navigateur.
    timeZone: 'Europe/Paris',
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
