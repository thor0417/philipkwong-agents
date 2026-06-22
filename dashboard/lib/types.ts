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
  date_found: string;
  outreach_drafted: boolean;
  outreach_approved: boolean;
  outreach_sent: boolean;
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
