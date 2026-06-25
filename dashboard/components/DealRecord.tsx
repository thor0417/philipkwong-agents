'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Activity, DealWithRelations, Outreach } from '@/lib/types';
import { STAGES } from '@/lib/types';
import {
  dealScore,
  dealSource,
  formatDate,
  scoreTier,
  sourceLabel,
} from '@/lib/crm';
import styles from './DealRecord.module.css';

export default function DealRecord({
  deal,
  outreach,
  activities,
  onClose,
  onRefresh,
}: {
  deal: DealWithRelations | null;
  outreach: Outreach[];
  activities: Activity[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  if (!deal) return null;
  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Deal record"
      >
        <Body
          key={deal.id}
          deal={deal}
          outreach={outreach}
          activities={activities}
          onClose={onClose}
          onRefresh={onRefresh}
        />
      </aside>
    </div>
  );
}

// Separated so a new `key` per deal resets all local edit state cleanly.
function Body({
  deal,
  outreach,
  activities,
  onClose,
  onRefresh,
}: {
  deal: DealWithRelations;
  outreach: Outreach[];
  activities: Activity[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const score = dealScore(deal);
  const source = dealSource(deal);

  // Drafts linked to this deal's originating lead.
  const drafts = outreach.filter(
    (o) => deal.lead_id && o.lead_id === deal.lead_id && o.status === 'pending'
  );
  const log = [...activities]
    .filter((a) => a.deal_id === deal.id)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  async function changeStage(stage: string) {
    await supabase
      .from('deals')
      .update({ stage, updated_at: new Date().toISOString() })
      .eq('id', deal.id);
    onRefresh();
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <div className={styles.company}>
            {deal.contacts?.company || deal.contacts?.name || 'No contact'}
          </div>
          <div className={styles.title}>{deal.title}</div>
        </div>
        <button className={styles.close} onClick={onClose}>
          Close
        </button>
      </header>

      <div className={styles.headMeta}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Stage</span>
          <select
            className={styles.select}
            value={deal.stage}
            onChange={(e) => changeStage(e.target.value)}
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <ValueField deal={deal} onRefresh={onRefresh} />
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Source</span>
          <span className={styles.tag}>{sourceLabel(source)}</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Score</span>
          {score !== null ? (
            <span className={`${styles.score} ${styles[scoreTier(score)]}`}>
              {score}
            </span>
          ) : (
            <span className={styles.tag}>—</span>
          )}
        </div>
      </div>

      <ContactSection deal={deal} onRefresh={onRefresh} />
      <OutreachQueue deal={deal} drafts={drafts} onRefresh={onRefresh} />
      <ActivityLog deal={deal} log={log} onRefresh={onRefresh} />
      <NextActionSection deal={deal} onRefresh={onRefresh} />
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

function ValueField({
  deal,
  onRefresh,
}: {
  deal: DealWithRelations;
  onRefresh: () => void;
}) {
  const [value, setValue] = useState(
    deal.value_estimate === null ? '' : String(deal.value_estimate)
  );

  async function save() {
    const num = value.trim() === '' ? null : Number(value);
    if (num !== null && Number.isNaN(num)) return;
    await supabase
      .from('deals')
      .update({ value_estimate: num, updated_at: new Date().toISOString() })
      .eq('id', deal.id);
    onRefresh();
  }

  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>Value (CAD)</span>
      <input
        className={styles.inlineInput}
        value={value}
        inputMode="numeric"
        placeholder="—"
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
      />
    </label>
  );
}

function ContactSection({
  deal,
  onRefresh,
}: {
  deal: DealWithRelations;
  onRefresh: () => void;
}) {
  const c = deal.contacts;
  const [form, setForm] = useState({
    name: c?.name ?? '',
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    company: c?.company ?? '',
    role: c?.role ?? '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!deal.contact_id) return;
    setSaving(true);
    await supabase
      .from('contacts')
      .update({
        name: form.name || null,
        email: form.email || null,
        phone: form.phone || null,
        company: form.company || null,
        role: form.role || null,
      })
      .eq('id', deal.contact_id);
    setSaving(false);
    onRefresh();
  }

  if (!deal.contact_id) {
    return (
      <Section title="Contact">
        <p className={styles.note}>No contact linked to this deal.</p>
      </Section>
    );
  }

  const fields: { key: keyof typeof form; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'company', label: 'Company' },
    { key: 'role', label: 'Role' },
  ];

  return (
    <Section title="Contact">
      <div className={styles.grid}>
        {fields.map((f) => (
          <label key={f.key} className={styles.field}>
            <span className={styles.fieldLabel}>{f.label}</span>
            <input
              className={styles.inlineInput}
              value={form[f.key]}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <button className={styles.save} onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save Contact'}
      </button>
    </Section>
  );
}

function OutreachQueue({
  deal,
  drafts,
  onRefresh,
}: {
  deal: DealWithRelations;
  drafts: Outreach[];
  onRefresh: () => void;
}) {
  return (
    <Section title={`Outreach Queue (${drafts.length})`}>
      {drafts.length === 0 && (
        <p className={styles.note}>No pending drafts for this deal.</p>
      )}
      {drafts.map((d) => (
        <DraftCard key={d.id} deal={deal} draft={d} onRefresh={onRefresh} />
      ))}
    </Section>
  );
}

function DraftCard({
  deal,
  draft,
  onRefresh,
}: {
  deal: DealWithRelations;
  draft: Outreach;
  onRefresh: () => void;
}) {
  const [subject, setSubject] = useState(`Re: ${deal.title}`);
  const [body, setBody] = useState(draft.draft_content ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const to = deal.contacts?.email ?? '';

  async function approve() {
    setError(null);
    if (!to) {
      setError('No contact email on this deal — cannot send.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outreach_id: draft.id,
          deal_id: deal.id,
          contact_id: deal.contact_id,
          to,
          subject,
          body,
        }),
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
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Subject</span>
        <input
          className={styles.inlineInput}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>To: {to || '— no email —'}</span>
        <textarea
          className={styles.textarea}
          value={body}
          rows={8}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.draftActions}>
        <button className={styles.approve} onClick={approve} disabled={busy}>
          {busy ? 'Working…' : 'Approve & Send'}
        </button>
        <button className={styles.reject} onClick={reject} disabled={busy}>
          Reject
        </button>
      </div>
    </div>
  );
}

const TYPE_ICON: Record<string, string> = {
  email_sent: '→',
  email_received: '←',
  note: '•',
  call: '☎',
};

function ActivityLog({
  deal,
  log,
  onRefresh,
}: {
  deal: DealWithRelations;
  log: Activity[];
  onRefresh: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');

  async function saveNote() {
    if (!note.trim()) {
      setAdding(false);
      return;
    }
    await supabase.from('activities').insert({
      deal_id: deal.id,
      contact_id: deal.contact_id,
      type: 'note',
      content: note.trim(),
    });
    setNote('');
    setAdding(false);
    onRefresh();
  }

  return (
    <Section title="Activity Log">
      {log.length === 0 && !adding && (
        <p className={styles.note}>No activity yet.</p>
      )}
      <ul className={styles.log}>
        {log.map((a) => (
          <li key={a.id} className={styles.logItem}>
            <span className={styles.logIcon}>{TYPE_ICON[a.type] ?? '•'}</span>
            <div>
              <div className={styles.logMeta}>
                {a.type.replace('_', ' ')} · {formatDate(a.created_at)}
              </div>
              {a.subject && <div className={styles.logSubject}>{a.subject}</div>}
              {a.content && <div className={styles.logBody}>{a.content}</div>}
            </div>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className={styles.noteForm}>
          <textarea
            className={styles.textarea}
            value={note}
            rows={3}
            placeholder="Add a note…"
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
          <div className={styles.draftActions}>
            <button className={styles.save} onClick={saveNote}>
              Save Note
            </button>
            <button className={styles.reject} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className={styles.save} onClick={() => setAdding(true)}>
          Add Note
        </button>
      )}
    </Section>
  );
}

function NextActionSection({
  deal,
  onRefresh,
}: {
  deal: DealWithRelations;
  onRefresh: () => void;
}) {
  const [text, setText] = useState(deal.next_action ?? '');
  const [date, setDate] = useState(
    deal.next_action_date ? deal.next_action_date.slice(0, 10) : ''
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await supabase
      .from('deals')
      .update({
        next_action: text || null,
        next_action_date: date ? new Date(date).toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', deal.id);
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
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Due Date</span>
        <input
          className={styles.inlineInput}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <button className={styles.save} onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save Next Action'}
      </button>
    </Section>
  );
}
