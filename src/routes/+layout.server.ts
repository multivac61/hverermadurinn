import type { LayoutServerLoad } from './$types';

const SITE_URL = 'https://hverermadurinn.is';
const SITE_NAME = 'Hver er maðurinn?';

export const load: LayoutServerLoad = async ({ url }) => {
  const gRaw = url.searchParams.get('g') ?? '';
  const guesses = Number.parseInt(gRaw, 10);
  const hasGuesses = Number.isFinite(guesses) && guesses > 0;

  const description = hasGuesses
    ? `Ég leysti leik dagsins í ${guesses} giskum. Prófaðu á hverermadurinn.is.`
    : 'Daglegur giskileikur. Þú hefur 20 spurningar til að finna persónu dagsins.';

  const ogImage = hasGuesses
    ? `${SITE_URL}/og-image.svg?g=${encodeURIComponent(String(guesses))}`
    : `${SITE_URL}/og-image.svg`;

  return {
    seo: {
      siteName: SITE_NAME,
      siteUrl: SITE_URL,
      pageUrl: `${SITE_URL}${url.pathname}${url.search}`,
      description,
      ogImage
    }
  };
};
