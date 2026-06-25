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
