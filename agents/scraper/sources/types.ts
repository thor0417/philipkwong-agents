// Shared shape every source adapter returns.
//
// Adapters do NO relevance filtering of their own (except unavoidable
// source-side query/CPV constraints): they normalize and hand back rows. The
// orchestrator runs the profile-driven prefilter, broker-filter, and scorer.

export interface NormalizedLead {
  title: string;
  url: string;
  raw_content: string;
  company: string | null;
  location: string | null;
  // ISO 8601 timestamp string, or null when absent/unparseable.
  deadline: string | null;
  value_estimate: string | null;
  source: string;
  // Optional ISO-3166 alpha-2 country code. Set by sources that know the
  // project country directly (IADB, and the LATAM/Caribbean signal sources) so
  // region grouping does not have to infer it from a free-text location.
  country?: string;
  // Signals lane (Part B). Populated only by private-developer signal sources
  // (FONATUR, CONFOTUR, Bahamas HOA, SEMARNAT, NEPA, Cayman CPA). These leads are
  // captured on legitimacy through the signals lane, never fit-scored.
  signal_type?: string; // 'land_acquisition' | 'incentive_approval' | 'development_application'
  regulator?: string; // issuing body, e.g. 'FONATUR', 'CONFOTUR', 'NEPA'
  project_description?: string;
  signal_date?: string | null; // ISO date (YYYY-MM-DD) of the filing/announcement
  // True when the source can tell the filing was withdrawn/rejected/denied; the
  // signals lane never writes these.
  withdrawn?: boolean;
}

// Track B: registry leads. Entities licensed to physically handle fuel.
// These skip the broker-filter and Haiku scoring (licensed = legitimate) and
// are written with a fixed baseline score.
export interface RegistryLead {
  company: string;
  license_type: string; // 'bunker supplier' | 'bunker craft operator' | 'terminal operator'
  port: string;
  region: string; // 'NL' | 'SG'
  status: string;
  url: string;
  source: string;
  raw_content: string;
}

// Parse a loosely-formatted date into an ISO string, or null if unusable.
export function toIso(value: string | undefined | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
