'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Lead, Outreach } from '@/lib/types';
import {
  STATUS_OPTIONS,
  formatDate,
  leadClosing,
  leadOrg,
  normalizeStatus,
  scoreTier,
  sourceLabel,
} from '@/lib/leads';
import {
  FUEL_NOTICE_OPTIONS,
  FUEL_PRODUCT_OPTIONS,
  CONSULTING_SUB_OPTIONS,
} from '@/lib/category';
import SourceLink from './SourceLink';
import styles from './DealRecord.module.css';

export default function DealRecord({
  lead,
  outreach,
  onClose,
  onRefresh,
}: {
  lead: Lead | null;
  outreach: Outreach[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  if (!lead) return null;
  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Lead record"
      >
        <Body
          key={lead.id}
          lead={lead}
          outreach={outreach}
          onClose={onClose}
          onRefresh={onRefresh}
        />
      </aside>
    </div>
  );
}

// Separated so a new `key` per lead resets all local edit state cleanly.
function Body({
  lead,
  outreach,
  onClose,
  onRefresh,
}: {
  lead: Lead;
  outreach: Outreach[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const score = lead.score ?? 0;
  const drafts = outreach.filter((o) => o.lead_id === lead.id);

  async function changeStatus(status: string) {
    await supabase.from('leads').update({ status }).eq('id', lead.id);
    onRefresh();
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <div className={styles.company}>{leadOrg(lead)}</div>
          <div className={styles.title}>{lead.title ?? '—'}</div>
        </div>
        <button className={styles.close} onClick={onClose}>
          Close
        </button>
      </header>

      <div className={styles.headMeta}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Status</span>
          <select
            className={styles.select}
            value={normalizeStatus(lead.status)}
            onChange={(e) => changeStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Score</span>
          <span className={`${styles.score} ${styles[scoreTier(score)]}`}>
            {score}
          </span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Source</span>
          <span className={styles.tag}>{sourceLabel(lead.source)}</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Found</span>
          <span className={styles.tag}>{formatDate(lead.date_found)}</span>
        </div>
      </div>

      <LeadDetails lead={lead} />
      <ClassificationSection lead={lead} onRefresh={onRefresh} />
      <LeadDetailSection lead={lead} />
      <OutreachQueue drafts={drafts} onRefresh={onRefresh} />
      <NextActionSection lead={lead} onRefresh={onRefresh} />
      <NotesSection lead={lead} onRefresh={onRefresh} />
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>{title}</div>
      {children}
    </section>
  );
}

function LeadDetails({ lead }: { lead: Lead }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Jurisdiction', value: lead.jurisdiction ?? '—' },
    { label: 'Budget', value: lead.budget ?? '—' },
    { label: 'Closing', value: leadClosing(lead) },
  ];

  return (
    <Section title="Lead">
      <div className={styles.grid}>
        {rows.map((r) => (
          <div key={r.label} className={styles.field}>
            <span className={styles.fieldLabel}>{r.label}</span>
            <span className={styles.tag}>{r.value}</span>
          </div>
        ))}
      </div>
      {lead.score_reason && (
        <p className={styles.note}>{lead.score_reason}</p>
      )}
      <SourceLink url={lead.url} />
    </Section>
  );
}

// Scraper-engine fields. Each row renders only when its value is non-null and
// non-empty (matched_counterparty renders Yes/No, but is skipped when null).
function LeadDetailSection({ lead }: { lead: Lead }) {
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') {
      rows.push({ label, value });
    }
  };

  push('Module', lead.module);
  push('Industry', lead.industry);
  push('Region', lead.region);
  push('Lead Type', lead.lead_type);
  push('Company', lead.company);
  push('Deadline', lead.deadline ? lead.deadline.slice(0, 10) : null);
  push('Value Estimate', lead.value_estimate);
  push('Location', lead.location);
  push('License Type', lead.license_type);
  push('Port', lead.port);
  push(
    'Matched Counterparty',
    lead.matched_counterparty === null || lead.matched_counterparty === undefined
      ? null
      : lead.matched_counterparty
        ? 'Yes'
        : 'No'
  );

  if (rows.length === 0) return null;

  return (
    <Section title="Lead Detail">
      <div className={styles.grid}>
        {rows.map((r) => (
          <div key={r.label} className={styles.field}>
            <span className={styles.fieldLabel}>{r.label}</span>
            <span className={styles.tag}>{r.value}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// Classification tags with inline override. Category / subcategory /
// product_type are editable dropdowns written straight back to Supabase (the
// dashboard already updates leads with the anon client); is_cargo / volume /
// sector are read-only context shown for fuel leads.
function ClassificationSection({
  lead,
  onRefresh,
}: {
  lead: Lead;
  onRefresh: () => void;
}) {
  const isFuel = lead.category === 'fuel';
  const subOptions = (isFuel ? FUEL_NOTICE_OPTIONS : CONSULTING_SUB_OPTIONS).filter(
    (o) => o.key !== 'all'
  );
  const productOptions = FUEL_PRODUCT_OPTIONS.filter((o) => o.key !== 'all');

  async function update(
    patch: Partial<Pick<Lead, 'category' | 'subcategory' | 'product_type'>>
  ) {
    await supabase.from('leads').update(patch).eq('id', lead.id);
    onRefresh();
  }

  return (
    <Section title="Classification">
      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Category</span>
          <select
            className={styles.select}
            value={lead.category ?? ''}
            onChange={(e) => update({ category: e.target.value || null })}
          >
            <option value="">—</option>
            <option value="fuel">Fuel</option>
            <option value="consulting">Consulting</option>
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Subcategory</span>
          <select
            className={styles.select}
            value={lead.subcategory ?? ''}
            onChange={(e) => update({ subcategory: e.target.value || null })}
          >
            <option value="">—</option>
            {subOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {isFuel && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Product Type</span>
            <select
              className={styles.select}
              value={lead.product_type ?? ''}
              onChange={(e) => update({ product_type: e.target.value || null })}
            >
              <option value="">—</option>
              {productOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {isFuel && (
        <div className={styles.grid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Cargo</span>
            <span className={styles.tag}>{lead.is_cargo ? 'Yes' : 'No'}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Volume</span>
            <span className={styles.tag}>{lead.volume_estimate ?? '—'}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Sector</span>
            <span className={styles.tag}>{lead.sector ?? '—'}</span>
          </div>
        </div>
      )}
    </Section>
  );
}

function OutreachQueue({
  drafts,
  onRefresh,
}: {
  drafts: Outreach[];
  onRefresh: () => void;
}) {
  return (
    <Section title={`Outreach Drafts (${drafts.length})`}>
      {drafts.length === 0 && (
        <p className={styles.note}>No drafts linked to this lead.</p>
      )}
      {drafts.map((d) => (
        <DraftCard key={d.id} draft={d} onRefresh={onRefresh} />
      ))}
    </Section>
  );
}

function DraftCard({
  draft,
  onRefresh,
}: {
  draft: Outreach;
  onRefresh: () => void;
}) {
  const sent = draft.status === 'sent';
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(draft.draft_content ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setError(null);
    if (!to.trim() || !subject.trim()) {
      setError('A recipient and subject are required to send.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outreach_id: draft.id, to, subject, body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Send failed (${res.status})`);
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed.');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    await supabase.from('outreach').delete().eq('id', draft.id);
    setBusy(false);
    onRefresh();
  }

  return (
    <div className={styles.draft}>
      <div className={styles.fieldLabel}>
        {sent ? `Sent ${formatDate(draft.sent_at)}` : 'Pending'}
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>To</span>
        <input
          className={styles.inlineInput}
          value={to}
          placeholder="recipient@example.com"
          disabled={sent}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Subject</span>
        <input
          className={styles.inlineInput}
          value={subject}
          disabled={sent}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Draft</span>
        <textarea
          className={styles.textarea}
          value={body}
          rows={8}
          disabled={sent}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      {!sent && (
        <div className={styles.draftActions}>
          <button className={styles.approve} onClick={approve} disabled={busy}>
            {busy ? 'Working…' : 'Approve & Send'}
          </button>
          <button className={styles.reject} onClick={reject} disabled={busy}>
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function NextActionSection({
  lead,
  onRefresh,
}: {
  lead: Lead;
  onRefresh: () => void;
}) {
  const [text, setText] = useState(lead.next_action ?? '');
  const [date, setDate] = useState(
    lead.next_action_date ? lead.next_action_date.slice(0, 10) : ''
  );
  const [saving, setSaving] = useState(false);

  // Overdue = the saved due date is strictly before today.
  const overdue =
    !!lead.next_action_date &&
    new Date(lead.next_action_date).getTime() < Date.now();

  async function save() {
    setSaving(true);
    await supabase
      .from('leads')
      .update({
        next_action: text || null,
        next_action_date: date ? new Date(date).toISOString() : null,
      })
      .eq('id', lead.id);
    setSaving(false);
    onRefresh();
  }

  return (
    <Section title="Next Action">
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Action</span>
        <input
          className={styles.inlineInput}
          value={text}
          placeholder="Describe the next step…"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className={styles.field} style={{ marginTop: 12 }}>
        <span className={styles.fieldLabel}>Due Date</span>
        <input
          className={styles.inlineInput}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      {lead.next_action_date && (
        <p className={overdue ? styles.overdue : styles.note}>
          Due {formatDate(lead.next_action_date)}
          {overdue ? ' — overdue' : ''}
        </p>
      )}
      <div className={styles.draftActions}>
        <button className={styles.save} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Next Action'}
        </button>
      </div>
    </Section>
  );
}

function NotesSection({
  lead,
  onRefresh,
}: {
  lead: Lead;
  onRefresh: () => void;
}) {
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await supabase
      .from('leads')
      .update({ notes: notes || null })
      .eq('id', lead.id);
    setSaving(false);
    onRefresh();
  }

  return (
    <Section title="Notes">
      <textarea
        className={styles.textarea}
        value={notes}
        rows={4}
        placeholder="Add notes about this lead…"
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className={styles.draftActions}>
        <button className={styles.save} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Notes'}
        </button>
      </div>
    </Section>
  );
}
