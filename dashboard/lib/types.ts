// Shared row types matching the Supabase schema.

export interface Lead {
  id: string;
  source: string;
  url: string;
  title: string | null;
  raw_content: string | null;
  score: number | null;
  score_reason: string | null;
  status: string | null;
  jurisdiction: string | null;
  budget: string | null;
  notes: string | null;
  next_action: string | null;
  next_action_date: string | null;
  date_found: string;
  outreach_drafted: boolean;
  outreach_approved: boolean;
  outreach_sent: boolean;
  // Scraper engine fields (populated by agents/scraper).
  module: string | null;
  industry: string | null;
  region: string | null;
  lead_type: string | null;
  company: string | null;
  deadline: string | null;
  value_estimate: string | null;
  location: string | null;
  license_type: string | null;
  port: string | null;
  matched_counterparty: boolean | null;
  // Classification tags (agents/scraper/classify.ts).
  category: string | null;
  subcategory: string | null;
  product_type: string | null;
  is_cargo: boolean | null;
  volume_estimate: string | null;
  sector: string | null;
  // Signals lane (Part B, LATAM/Caribbean).
  signal_type: string | null;
  signal_date: string | null;
  regulator: string | null;
  project_description: string | null;
}

export interface Agent {
  id: string;
  name: string;
  last_run: string | null;
  leads_found: number | null;
  status: string | null;
  error: string | null;
  created_at: string;
}

export interface Outreach {
  id: string;
  lead_id: string | null;
  draft_content: string | null;
  status: string | null;
  sent_at: string | null;
  reply_received: boolean;
  created_at: string;
}

export interface Contact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
}

export interface Deal {
  id: string;
  contact_id: string | null;
  lead_id: string | null;
  title: string;
  stage: string;
  value_estimate: number | null;
  source: string | null;
  service_tier: string | null;
  notes: string | null;
  next_action: string | null;
  next_action_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  deal_id: string | null;
  contact_id: string | null;
  type: string;
  direction: string | null;
  subject: string | null;
  content: string | null;
  created_at: string;
}

// A deal joined with the lead it came from (score/source live on the lead)
// and the contact it belongs to. Built by the pipeline page's Supabase query.
export interface DealWithRelations extends Deal {
  leads: Pick<
    Lead,
    'score' | 'source' | 'title' | 'url' | 'date_found'
  > | null;
  contacts: Contact | null;
}

export const STAGES = [
  { value: 'new_lead', label: 'New Lead' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'replied', label: 'Replied' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal_sent', label: 'Proposal Sent' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
] as const;

// GLI lane (Grant Leisure International): leisure / attraction / hospitality /
// gaming / cultural venue opportunities. Rows live in `leads` where module =
// 'gli'; this is the subset of columns the GLI dashboard reads.
export interface GLILead {
  id: string;
  title: string | null;
  venue_type: string | null;
  signal_type: string | null;
  location: string | null;
  company: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  url: string | null;
  raw_content: string | null;
  date_found: string | null;
  score: number | null;
  source_tier: string | null;
  // Lane sub-tag: 'opportunity' (Tier 1), 'intelligence' (Tier 3), 'government'
  // (Tier 2). The GLI page's three tabs read this column.
  stream: string | null;
  // Bid deadline (opportunities) and source publication date (intelligence /
  // government records), ISO strings when present.
  deadline: string | null;
  published_date: string | null;
  // Date provenance (migration 012). date_source records how the filterable date
  // was obtained: 'source' (adapter exposed it), 'parsed' (extracted from the lead
  // text), 'first_seen' (no date; the honest floor), or null (not yet backfilled).
  // first_seen is when the row was first written. Optional: present only after 012.
  date_source?: string | null;
  first_seen?: string | null;
  // Two-object model (migration 013). object_type: 'opportunity' (deadline-bound
  // solicitation) or 'project_event' (everything else). milestone_date: the max
  // FUTURE date parsed from the lead text (opening/completion/hearing) -- a project
  // with a future milestone is always live. Optional: present only after 013.
  object_type?: string | null;
  milestone_date?: string | null;
  // Raw source slug (portal / trade domain / legistar).
  source: string | null;
  // Development category. Derived from venue_type via the canonical taxonomy
  // (lib/taxonomy.ts VENUE_TO_CATEGORY); never null in practice ('Other' fallback).
  development_category?: string | null;
  // Pass 4 government (Tier 2) fields. Optional: present only after the 009-011
  // migrations, and only populated on government-stream leads.
  source_type?: string | null;
  presented_by?: string | null;
  applicant?: string | null;
  representative?: string | null;
  action_sought?: string | null;
  primary_document_url?: string | null;
  has_primary_document?: boolean | null;
}

export const GLI_SIGNAL_ORDER = [
  'Origination',
  'Feasibility RFP',
  'Engineering/Technical',
  'Operator/Management',
  'Investment/Funding',
  'General News',
] as const;

// Venue types are the canonical VENUE_TYPES in lib/taxonomy.ts (single source of
// truth). No parallel list is defined here.
