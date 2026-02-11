import type { RequestHandler } from '@sveltejs/kit';

function esc(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const GET: RequestHandler = async ({ url }) => {
  const guessesRaw = url.searchParams.get('g') ?? '';
  const guesses = Number.parseInt(guessesRaw, 10);

  const title = 'Hver er maðurinn?';
  const line1 = Number.isFinite(guesses)
    ? `Ég leysti leik dagsins í ${guesses} giskum.`
    : 'Getur þú giskað á persónu dagsins?';
  const line2 = 'Spilaðu á hverermadurinn.is';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#f4f4f5" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>

  <text x="72" y="160" fill="#09090b" font-size="76" font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="800">
    ${esc(title)}
  </text>

  <text x="72" y="285" fill="#18181b" font-size="46" font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="600">
    ${esc(line1)}
  </text>

  <text x="72" y="360" fill="#3f3f46" font-size="40" font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="500">
    ${esc(line2)}
  </text>

  <rect x="72" y="468" width="430" height="66" rx="16" fill="#111827" />
  <text x="96" y="512" fill="#ffffff" font-size="34" font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="700">
    Leikur dagsins
  </text>
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300'
    }
  });
};
