// RUN SCOPE: which pipeline, which markets, which sources this run touches.
//
// THE PROBLEM. Lanes run as lanes. Touching Clark County means running
// everything: eight adapters, six Legistar jurisdictions, 200 CEQAnet rows and
// every CFTOD board packet. That is merely slow at ten markets and impossible at
// twenty-five, but the sharper cost is that it makes a DEMO RUN RISKY - there is
// no way to exercise one market in front of someone without touching the whole
// corpus and everything that writes to it.
//
// SCOPE NARROWS, IT NEVER WIDENS. The default is everything, which is exactly
// what every existing caller and every cron entry already gets, so adding this
// changes no behaviour until somebody asks for less.
//
// THREE AXES, AND THEY COMPOSE. --pipeline, --market and --source are ANDed:
//
//   npm run scrape:government -- --market="Clark County"
//   npm run scrape:government -- --market="Clark County" --source=legistar
//   npm run scrape:all -- --pipeline=hospitality --market=Anaheim
//
// Each accepts a comma-separated list. Env equivalents (RUN_PIPELINE, RUN_MARKET,
// RUN_SOURCE) exist because npm swallows argv in some shells and a cron entry is
// easier to write with env vars.
//
// A PARTIAL RUN MUST NEVER BE MISTAKEN FOR A FULL ONE. That is the real risk
// this introduces: a scoped run that writes fewer records looks exactly like a
// lane that half died. So every run report states its scope, describeScope
// always returns a non-empty phrase, and isFullRun exists so the report can say
// FULL RUN or PARTIAL RUN in as many words rather than leaving it to be inferred
// from a count.

export interface RunScope {
  // null means "every pipeline", not "no pipeline". Same for the other two.
  pipeline: string | null;
  markets: string[] | null;
  sources: string[] | null;
}

export const FULL_SCOPE: RunScope = { pipeline: null, markets: null, sources: null };

// A market or source name reduced to its comparable form: lower case, every run
// of non-alphanumerics collapsed to one space. So "Clark County, NV" and
// "clark county nv" compare equal, and a caller does not have to know how a
// jurisdiction label is punctuated.
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// The shortest request allowed. A one- or two-character market would match
// almost every label under the prefix rule below, which would silently turn a
// typo into a full run - the exact failure this module exists to prevent.
const MIN_TERM = 3;

function splitList(raw: string | undefined | null): string[] | null {
  if (raw === undefined || raw === null) return null;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : null;
}

// Read --key=value or --key value from argv.
function flag(argv: string[], key: string): string | undefined {
  const eq = `--${key}=`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith(eq)) return a.slice(eq.length).replace(/^["']|["']$/g, '');
    if (a === `--${key}` && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      return argv[i + 1].replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

export function parseRunScope(
  argv: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env
): RunScope {
  const pipeline = flag(argv, 'pipeline') ?? env.RUN_PIPELINE;
  const market = flag(argv, 'market') ?? env.RUN_MARKET;
  const source = flag(argv, 'source') ?? env.RUN_SOURCE;
  return {
    pipeline: pipeline && pipeline.trim() ? pipeline.trim() : null,
    markets: splitList(market),
    sources: splitList(source),
  };
}

// Does a requested term match a declared label?
//
// Matching is PREFIX-SYMMETRIC on the normalised forms, because neither side
// reliably knows how the other spells a place. The adapters carry
// "Clark County, NV" and a person types "Clark County"; CEQAnet carries
// "Anaheim, City of" and a person types "Anaheim". Both directions are accepted
// so either can be the more specific one.
//
// Prefix rather than substring, deliberately: substring would make "Oakland"
// match "Oakland County" and "Las Vegas" match nothing useful in either
// direction, and it would let a short term reach labels that merely contain it.
function termMatches(request: string, label: string): boolean {
  const r = norm(request);
  const l = norm(label);
  if (r.length < MIN_TERM || l.length === 0) return false;
  if (r === l) return true;
  return l.startsWith(`${r} `) || r.startsWith(`${l} `);
}

// Is this market in scope? A null market filter means every market.
export function scopeIncludesMarket(scope: RunScope, label: string | null | undefined): boolean {
  if (!scope.markets) return true;
  if (!label) return false;
  return scope.markets.some((m) => termMatches(m, label));
}

// Is this market in scope, given a set of labels an adapter covers? True when
// ANY of them is in scope, because an adapter covering six jurisdictions is in
// scope if one of them was asked for; it then filters internally.
export function scopeIncludesAnyMarket(scope: RunScope, labels: readonly string[]): boolean {
  if (!scope.markets) return true;
  return labels.some((l) => scopeIncludesMarket(scope, l));
}

// Is this source in scope? Matched on the adapter name the health surface uses
// ('legistar', 'clark-tab', 'anaheim-agendas'), so what a person types to scope
// a run is the same string the run report prints back at them.
export function scopeIncludesSource(scope: RunScope, source: string): boolean {
  if (!scope.sources) return true;
  return scope.sources.some((s) => termMatches(s, source) || norm(s) === norm(source));
}

export function scopeIncludesPipeline(scope: RunScope, pipeline: string): boolean {
  if (!scope.pipeline) return true;
  return norm(scope.pipeline) === norm(pipeline);
}

export function isFullRun(scope: RunScope): boolean {
  return !scope.pipeline && !scope.markets && !scope.sources;
}

// A phrase for the run report. Never empty: a run with no narrowing says so, so
// the report always makes a positive statement about what it covered rather than
// staying silent and letting a partial run read as a full one.
export function describeScope(scope: RunScope): string {
  if (isFullRun(scope)) return 'FULL RUN (all pipelines, all markets, all sources)';
  const parts: string[] = [];
  parts.push(`pipeline=${scope.pipeline ?? 'all'}`);
  parts.push(`markets=${scope.markets ? scope.markets.join(', ') : 'all'}`);
  parts.push(`sources=${scope.sources ? scope.sources.join(', ') : 'all'}`);
  return `PARTIAL RUN (${parts.join('; ')})`;
}
