'use client';

// THE REPORTS COMPOSER. Scope, sections, preview.
//
// This is the product surface. Everything else in the dashboard exists so that
// this screen can produce a document worth paying for.
//
// SELECTING A CLIENT INHERITS THEIR SCOPE AND DOES NOT WRITE BACK TO IT. A
// report scoped to one county this month must not permanently narrow what that
// client is covered for. The override lives in this screen's state and dies
// with it; changing the stored scope is done on the client detail, deliberately,
// with its own save button.
//
// THE PREVIEW IS THE DOCUMENT. Same sections, same lines, same provenance tags,
// same order, at reduced scale - built by the same buildReport() the generator
// uses. A preview assembled separately from the generator is a preview that will
// eventually disagree with what gets sent.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import PeriodSelector from '@/components/PeriodSelector';
import { usePeriodState } from '@/lib/use-period';
import { useClients, useScopes } from '@/lib/use-clients';
import { HOSPITALITY_ID } from '@/lib/pipelines';
import { authedFetch } from '@/lib/authed-fetch';
import type { ClientScope } from '@/lib/clients';
import { buildReport, geographyLabel, listScopeProjects } from '@/lib/report-build';
import { DEFAULT_SECTION_IDS, SECTION_REGISTRY, sectionById } from '@/lib/report-sections';
import { basisLine, estimatePages, provenanceTally } from '@/lib/report-model';
import styles from './page.module.css';

const TEMPLATE_KEY = 'pk-report-templates';

interface Template {
  name: string;
  sectionIds: string[];
  commentary: Record<string, string>;
  title: string;
  watchlistOnly: boolean;
  includeDormant: boolean;
  includeContext: boolean;
  period: string;
}

// TEMPLATES LIVE IN THE BROWSER, and that is a stated limitation rather than a
// design. A templates table is DDL, which is Philip's to run and is not in this
// brief's migrations. localStorage means a template does not follow him to
// another machine, and the screen says so where they are saved rather than
// letting him find out.
function loadTemplates(): Template[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TEMPLATE_KEY);
    return raw ? (JSON.parse(raw) as Template[]) : [];
  } catch {
    return [];
  }
}

function saveTemplates(list: Template[]): void {
  try {
    window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(list));
  } catch {
    /* a full or blocked storage must not take the composer down */
  }
}

const EMPTY_SCOPE: ClientScope = {
  id: 'ad-hoc',
  client_id: '',
  pipeline_id: HOSPITALITY_ID,
  countries: [],
  regions: [],
  markets: [],
  streams: [],
  development_categories: [],
  venue_types: [],
  stages: [],
  watch_terms: [],
  notes: null,
  created_at: null,
};

export default function ReportsPage() {
  const clients = useClients();
  const [clientId, setClientId] = useState<string>('');
  const clientScopes = useScopes(clientId);
  const { period, setToken: setPeriod } = usePeriodState('last-month');
  const periodNow = useMemo(() => new Date(), []);

  const [title, setTitle] = useState('Market intelligence report');
  const [brandOverride, setBrandOverride] = useState('');
  const [addresseeOverride, setAddresseeOverride] = useState('');
  const [marketOverride, setMarketOverride] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [includeDormant, setIncludeDormant] = useState(false);
  const [includeContext, setIncludeContext] = useState(true);
  const [sectionIds, setSectionIds] = useState<string[]>(DEFAULT_SECTION_IDS);
  const [commentary, setCommentary] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTemplates(loadTemplates()), []);

  const client = (clients.data ?? []).find((c) => c.id === clientId) ?? null;
  const storedScope = (clientScopes.data ?? [])[0] ?? null;

  // THE INHERITED SCOPE, WITH THIS REPORT'S OVERRIDE APPLIED. The override is a
  // narrowing of the client's markets, never a widening: a one-off report may
  // cover less than the retainer, and offering to cover more of it here would
  // quietly change what they are owed.
  const effectiveScope: ClientScope = useMemo(() => {
    const base = storedScope ?? EMPTY_SCOPE;
    if (!marketOverride) return base;
    return { ...base, markets: [marketOverride] };
  }, [storedScope, marketOverride]);

  const brandName = brandOverride || client?.brand_name || 'Philip Kwong';
  const addressee = addresseeOverride || client?.addressee || client?.name || 'Internal';

  const choices = useQuery({
    queryKey: ['report', 'choices', effectiveScope.id, JSON.stringify(effectiveScope.markets)],
    queryFn: () => listScopeProjects(effectiveScope),
  });
  const projectChoices = choices.data ?? [];

  const built = useQuery({
    queryKey: [
      'report',
      'build',
      effectiveScope.id,
      JSON.stringify(effectiveScope.markets),
      JSON.stringify(effectiveScope.stages),
      period.since ?? '',
      period.until ?? '',
      projectId,
      sectionIds.join(','),
      JSON.stringify(commentary),
      title,
      brandName,
      addressee,
      watchlistOnly,
      includeDormant,
      includeContext,
    ],
    queryFn: () =>
      buildReport({
        scope: effectiveScope,
        period,
        sectionIds,
        commentary,
        title,
        brandName,
        addressee,
        clientName: client?.name ?? null,
        watchlistOnly,
        includeDormant,
        includeContext,
        projectId: projectId || null,
        geographyLabel: projectId
          ? (projectChoices.find((p) => p.id === projectId)?.name ?? 'one project')
          : marketOverride || geographyLabel(effectiveScope),
      }),
  });

  const doc = built.data?.doc;
  const tally = doc ? provenanceTally(doc) : null;

  const available = SECTION_REGISTRY.filter((s) => !sectionIds.includes(s.id));

  const move = useCallback((from: string, to: string) => {
    setSectionIds((prev) => {
      const next = [...prev];
      const i = next.indexOf(from);
      const j = next.indexOf(to);
      if (i < 0 || j < 0) return prev;
      next.splice(i, 1);
      next.splice(j, 0, from);
      return next;
    });
  }, []);

  async function generate(format: 'pdf' | 'csv' | 'xlsx') {
    if (!doc) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await authedFetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc,
          format,
          clientId: clientId || null,
          documentType: title,
          periodStart: period.since?.slice(0, 10) ?? null,
          periodEnd: period.until ? new Date(Date.parse(period.until) - 86_400_000).toISOString().slice(0, 10) : null,
          scope: {
            markets: effectiveScope.markets,
            stages: effectiveScope.stages,
            pipeline_id: effectiveScope.pipeline_id,
            period: period.key,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setError(body.error ?? `Generation failed (${res.status}).`);
        return;
      }
      const logged = res.headers.get('X-Delivery-Logged') === 'true';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (res.headers.get('Content-Disposition') ?? '').match(/filename="(.+?)"/)?.[1] ?? `report.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(
        logged
          ? `Generated ${format.toUpperCase()}. Delivery recorded.`
          : `Generated ${format.toUpperCase()}. DELIVERY NOT RECORDED: ${res.headers.get('X-Delivery-Error') ?? 'unknown'}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.screen}>
      {/* ------------------------------------------------------ 1. SCOPE */}
      <div className={styles.col}>
        <h2 className={styles.colTitle}>Scope</h2>

        <label className={styles.field}>
          <span className={styles.label}>Client</span>
          <select
            className={styles.select}
            data-testid="report-client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">No client (internal)</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <span className={styles.hint}>
            Selecting a client loads their stored scope, brand and addressee.
            Overriding anything here changes this report only.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Title</span>
          <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <div className={styles.field}>
          <span className={styles.label}>Period</span>
          <PeriodSelector period={period} now={periodNow} onChange={setPeriod} showRolling={false} />
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Narrow to one market</span>
          <select
            className={styles.select}
            data-testid="report-market"
            value={marketOverride}
            onChange={(e) => setMarketOverride(e.target.value)}
          >
            <option value="">
              {storedScope?.markets?.length ? storedScope.markets.join(', ') : 'All in scope'}
            </option>
            {(storedScope?.markets ?? []).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <span className={styles.hint}>
            Narrows this report within the client&apos;s scope. It cannot widen it.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Single project (referral brief)</span>
          <select
            className={styles.select}
            data-testid="report-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Every project in scope</option>
            {projectChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.market ? ` (${p.market})` : ''}
              </option>
            ))}
          </select>
          <span className={styles.hint}>
            A referral brief is about one matter, not a smaller market. Choosing a
            project here restricts the whole document to it, cover included.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Brand on the document</span>
          <input
            className={styles.input}
            value={brandOverride}
            placeholder={client?.brand_name ?? 'Philip Kwong'}
            onChange={(e) => setBrandOverride(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Addressee</span>
          <input
            className={styles.input}
            value={addresseeOverride}
            placeholder={client?.addressee ?? client?.name ?? 'Internal'}
            onChange={(e) => setAddresseeOverride(e.target.value)}
          />
        </label>

        <div className={styles.field}>
          <span className={styles.label}>Inclusions</span>
          <label className={styles.toggle}>
            <input type="checkbox" checked={watchlistOnly} onChange={(e) => setWatchlistOnly(e.target.checked)} />
            Watch list only
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={includeDormant} onChange={(e) => setIncludeDormant(e.target.checked)} />
            Include dormant projects
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={includeContext} onChange={(e) => setIncludeContext(e.target.checked)} />
            Include context records
          </label>
        </div>
      </div>

      {/* --------------------------------------------------- 2. SECTIONS */}
      <div className={styles.col}>
        <h2 className={styles.colTitle}>Sections</h2>
        <p className={styles.hint}>Drag to reorder. Every section can carry commentary.</p>

        <div data-testid="section-list">
          {sectionIds.map((id) => {
            const def = sectionById(id);
            if (!def) return null;
            return (
              <div
                key={id}
                data-section={id}
                className={`${styles.sectionItem} ${dragging === id ? styles.sectionItemDragging : ''}`}
                draggable
                onDragStart={() => setDragging(id)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragging && dragging !== id) move(dragging, id);
                  setDragging(null);
                }}
              >
                <span className={styles.grip} aria-hidden="true">::</span>
                <span className={styles.sectionName}>
                  {def.label}
                  <br />
                  <span className={styles.sectionDesc}>{def.description}</span>
                  <textarea
                    className={styles.textarea}
                    data-commentary={id}
                    placeholder="Commentary. Renders as [ASSESSMENT], set apart from the record."
                    value={commentary[id] ?? ''}
                    onChange={(e) => setCommentary({ ...commentary, [id]: e.target.value })}
                  />
                </span>
                <button
                  type="button"
                  className={styles.iconBtn}
                  aria-label={`Remove ${def.label}`}
                  onClick={() => setSectionIds(sectionIds.filter((x) => x !== id))}
                >
                  x
                </button>
              </div>
            );
          })}
        </div>

        {available.length > 0 && (
          <div className={styles.available}>
            <span className={styles.label}>Available</span>
            {available.map((def) => (
              <div key={def.id} className={styles.sectionItem}>
                <span className={styles.sectionName}>
                  {def.label}
                  <br />
                  <span className={styles.sectionDesc}>{def.description}</span>
                </span>
                <button
                  type="button"
                  className={styles.iconBtn}
                  data-add-section={def.id}
                  onClick={() => setSectionIds([...sectionIds, def.id])}
                >
                  +
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={styles.field}>
          <span className={styles.label}>Templates</span>
          <span className={styles.hint}>
            Saved in this browser only. A saved template is what a scheduled agent
            would later run, so shape it deliberately.
          </span>
          <select
            className={styles.select}
            value=""
            onChange={(e) => {
              const t = templates.find((x) => x.name === e.target.value);
              if (!t) return;
              setSectionIds(t.sectionIds);
              setCommentary(t.commentary);
              setTitle(t.title);
              setWatchlistOnly(t.watchlistOnly);
              setIncludeDormant(t.includeDormant);
              setIncludeContext(t.includeContext);
              setPeriod(t.period);
            }}
          >
            <option value="">Load a template...</option>
            {templates.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => {
              const name = window.prompt('Template name');
              if (!name) return;
              const next = [
                ...templates.filter((t) => t.name !== name),
                {
                  name,
                  sectionIds,
                  commentary,
                  title,
                  watchlistOnly,
                  includeDormant,
                  includeContext,
                  period: period.key,
                },
              ];
              setTemplates(next);
              saveTemplates(next);
            }}
          >
            Save as template
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------- 3. PREVIEW */}
      <div className={`${styles.col} ${styles.colLast}`}>
        <div className={styles.previewHead}>
          <span className={styles.statLabel}>Preview</span>
          <span className={styles.stat} data-testid="preview-projects-count">
            {built.isPending ? '--' : doc?.projectCount} projects
          </span>
          <span className={styles.stat} data-testid="preview-records-count">
            {built.isPending ? '--' : doc?.recordCount} records
          </span>
          <span className={styles.stat} data-testid="preview-pages">
            ~{built.data ? built.data.pages : '--'} pages
          </span>
          {tally && (
            <span className={styles.stat} data-testid="preview-provenance">
              {tally.RECORD} record / {tally.PRESS} press / {tally.ASSESSMENT} assessment
            </span>
          )}
        </div>

        {error && <div className={styles.error} role="alert">{error}</div>}
        {status && <div className={styles.status} data-testid="generate-status">{status}</div>}

        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={!doc || busy} data-testid="gen-pdf" onClick={() => generate('pdf')}>
            {busy ? 'Working...' : 'Generate PDF'}
          </button>
          <button type="button" className={styles.ghost} disabled={!doc || busy} data-testid="gen-csv" onClick={() => generate('csv')}>
            CSV
          </button>
          <button type="button" className={styles.ghost} disabled={!doc || busy} data-testid="gen-xlsx" onClick={() => generate('xlsx')}>
            XLSX
          </button>
        </div>

        {built.isError ? (
          <p className={styles.error}>Preview failed: {(built.error as Error).message}</p>
        ) : built.isPending || !doc ? (
          <p className={styles.hint}>Building...</p>
        ) : (
          <div className={styles.paper} data-testid="report-preview">
            <p className={styles.docBrand}>{doc.brandName}</p>
            <h1 className={styles.docTitle}>{doc.title}</h1>
            <p className={styles.docAddressee}>Prepared for {doc.addressee}</p>

            <div className={styles.scopeBox}>
              {([
                ['Geography', doc.scope.geography],
                ['Period', doc.scope.period],
                ['Pipeline', doc.scope.pipeline],
                ['Filters', doc.scope.filters.join(' | ') || 'none'],
                ['Basis', basisLine(doc.projectCount, doc.recordCount)],
              ] as const).map(([k, v]) => (
                <div key={k} className={styles.scopeRow}>
                  <span className={styles.scopeKey}>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
              {doc.scope.periodOpen && (
                <p className={styles.openWarn}>
                  This period has not closed. Regenerating later will cover more.
                </p>
              )}
            </div>

            {doc.sections.map((sec) => (
              <div key={sec.id} className={styles.docSection}>
                <h3 className={styles.docSectionTitle}>{sec.title}</h3>
                {sec.lede && <p className={styles.docLede}>{sec.lede}</p>}
                {sec.lines.slice(0, 40).map((l, i) => (
                  <div key={i} className={styles.docLine}>
                    <span className={`${styles.tag} ${l.provenance === 'ASSESSMENT' ? styles.tagAssessment : ''}`}>
                      [{l.provenance}]
                    </span>
                    <span className={styles.lineText}>
                      {l.text}
                      {l.meta && <div className={styles.lineMeta}>{l.meta}</div>}
                      {l.source && <div className={styles.lineSource}>{l.sourceLabel ?? l.source}</div>}
                    </span>
                  </div>
                ))}
                {sec.lines.length > 40 && (
                  <p className={styles.emptyNote}>
                    {sec.lines.length - 40} further lines in the generated document.
                  </p>
                )}
                {sec.emptyNote && <p className={styles.emptyNote}>{sec.emptyNote}</p>}
                {sec.commentary.length > 0 && (
                  <div className={styles.commentaryBlock}>
                    <p className={styles.commentaryHead}>Assessment</p>
                    {sec.commentary.map((l, i) => (
                      <div key={i} className={styles.docLine}>
                        <span className={`${styles.tag} ${styles.tagAssessment}`}>[{l.provenance}]</span>
                        <span className={styles.lineText}>{l.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
