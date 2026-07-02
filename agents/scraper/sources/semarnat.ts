// SEMARNAT MIA (Mexico) development-application signals — GATED best-effort.
//
// Every resort, hotel, marina, or distillery development in Mexico must file a
// Manifestacion de Impacto Ambiental (MIA) before construction, and new filings
// are listed in the weekly Gaceta Ecologica. The DATA is parseable (the Gaceta
// PDFs carry a real text layer: promovente, project, state, filing date), but
// ACCESS is blocked from this runtime: the SEMARNAT hosts are HTTP-only (no TLS
// on 443) and unreachable from non-Mexico egress (connection refused / dropped).
// Reliable pulling needs a Mexico-based egress / residential proxy or a
// Firecrawl-style fetcher with country=MX and plain-HTTP support.
//
// This adapter attempts the configured Gaceta index and, on the expected block,
// logs the access-type verdict and returns [] WITHOUT throwing. Point
// SEMARNAT_GACETA_URL at a reachable mirror (or a Firecrawl proxy URL) to enable;
// the weekly-PDF parser is intentionally not built until fetch is routable.
// signal_type 'development_application', regulator 'SEMARNAT', country MX.

import type { NormalizedLead } from './types';

const GACETA_URL = process.env.SEMARNAT_GACETA_URL ?? 'http://sinat.semarnat.gob.mx/Gaceta/aniosgaceta';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export async function scrapeSemarnat(): Promise<NormalizedLead[]> {
  try {
    const res = await fetch(GACETA_URL, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.warn(
        `SEMARNAT MIA: index HTTP ${res.status}. Gated (HTTP-only + Mexico geo-block); needs MX egress / Firecrawl country=MX. Skipping (0 leads).`
      );
      return [];
    }
    // Reached only from a Mexico-routable egress. The weekly-PDF parser is not
    // built yet (see file header); surface that rather than silently returning 0.
    console.warn(
      'SEMARNAT MIA: index reachable, but the Gaceta weekly-PDF parser is not built (deferred until fetch is routable). Skipping (0 leads).'
    );
    return [];
  } catch (error) {
    console.warn(
      `SEMARNAT MIA: fetch failed (${String(error).slice(0, 60)}). Gated (HTTP-only + Mexico geo-block); needs MX egress / Firecrawl country=MX. Skipping (0 leads).`
    );
    return [];
  }
}
