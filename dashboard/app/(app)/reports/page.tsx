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
import { useQueryState, parseAsString } from 'nuqs';
import PeriodSelector from '@/components/PeriodSelector';
import { usePeriodState } from '@/lib/use-period';
import { useClients, useScopes } from '@/lib/use-clients';
import { STREAMS } from '@/components/ScopeFields';
import { DEVELOPMENT_CATEGORIES, VENUE_TYPES } from '@/lib/taxonomy';
import { HOSPITALITY_ID, storageKeyFor } from '@/lib/pipelines';
import { useProjectFacet } from '@/lib/use-projects';
import type { FacetCount } from '@/lib/projects';
import { authedFetch } from '@/lib/authed-fetch';
import type { ClientScope } from '@/lib/clients';
import { buildReport, DETAIL_CAP_DEFAULT, geographyLabel, listScopeProjects } from '@/lib/report-build';
import {
  DEFAULT_SECTION_IDS,
  REFERRAL_SECTION_IDS,
  SECTION_REGISTRY,
  sectionById,
} from '@/lib/report-sections';
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
  // GEOGRAPHY IS THREE MULTI-SELECT AXES, NOT ONE DROPDOWN. It used to be a
  // single market string, so a report could be narrowed to exactly one market
  // and never to three, and neither country nor region could be touched at all.
  // A client scope holds a SET of markets (Simtec's holds sixteen), so the
  // composer could not express the thing the data model already supported.
  const [countryOverride, setCountryOverride] = useState<string[]>([]);
  const [regionOverride, setRegionOverride] = useState<string[]>([]);
  const [marketOverride, setMarketOverride] = useState<string[]>([]);
  // THE THREE AXES THE COMPOSER USED TO DROP. A client scope can constrain
  // venue type, development category and stream, and this screen offered no way
  // to see or narrow any of them: a report for a client scoped to attractions
  // was assembled, previewed and generated as though the constraint did not
  // exist. Same rule as the market override - narrowing only, and it dies with
  // this screen rather than editing what the client is covered for.
  const [venueOverride, setVenueOverride] = useState<string[]>([]);
  const [categoryOverride, setCategoryOverride] = useState<string[]>([]);
  const [streamOverride, setStreamOverride] = useState<string[]>([]);
  // THE PROJECT LIVES IN THE URL, so that another screen can hand this one a
  // referral to write. It was local state, which meant the only way to compose
  // a brief for a known project was to open this screen and hunt for it in a
  // dropdown of every project in scope - and meant a link to "the brief for
  // this project" could not be written at all, by a person or by the project
  // page's own button.
  const [projectId, setProjectId] = useQueryState('project', parseAsString.withDefault(''));
  // 'referral' starts the document from the referral section set instead of the
  // default one. Read once, on mount: it seeds the section list rather than
  // pinning it, so every section control stays usable afterwards.
  const [mode] = useQueryState('mode', parseAsString.withDefault(''));
  // HOW MANY PROJECTS THE DOCUMENT DESCRIBES. Held as a string because a number
  // input that coerces on every keystroke cannot be cleared to retype it: the
  // field snaps back to 1 the moment it empties. Parsed at the point of use.
  const [detailCapText, setDetailCapText] = useState(String(DETAIL_CAP_DEFAULT));
  const detailCap = Math.max(1, Number(detailCapText) || DETAIL_CAP_DEFAULT);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [includeDormant, setIncludeDormant] = useState(false);
  const [includeContext, setIncludeContext] = useState(true);
  const [sectionIds, setSectionIds] = useState<string[]>(
    mode === 'referral' ? REFERRAL_SECTION_IDS : DEFAULT_SECTION_IDS
  );
  const [commentary, setCommentary] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTemplates(loadTemplates()), []);

  // THE OPTIONS ARE THE CORPUS, NOT A FIXED LIST. Same facet source the client
  // scope editor uses, so the composer can never offer a market the register
  // does not hold, and never omit one it does.
  //
  // The three axes are NOT cascaded. Cascading would stop "Clark County plus
  // Las Vegas plus New York City" being expressible, which is three markets in
  // two states and exactly the case this exists for. resolveScope ANDs the
  // levels, so a region and a market outside it correctly match nothing - the
  // hint says so rather than the UI silently preventing it.
  const facetBase = { module: storageKeyFor(HOSPITALITY_ID), excludeStatus: 'dismissed' as const };
  const countryFacet = useProjectFacet(facetBase, 'country');
  const regionFacet = useProjectFacet(facetBase, 'region_state');
  const marketFacet = useProjectFacet(facetBase, 'market');

  const client = (clients.data ?? []).find((c) => c.id === clientId) ?? null;
  const storedScope = (clientScopes.data ?? [])[0] ?? null;

  // THE INHERITED SCOPE, WITH THIS REPORT'S OVERRIDE APPLIED. The override is a
  // narrowing of the client's markets, never a widening: a one-off report may
  // cover less than the retainer, and offering to cover more of it here would
  // quietly change what they are owed.
  const effectiveScope: ClientScope = useMemo(() => {
    const base = storedScope ?? EMPTY_SCOPE;
    return {
      ...base,
      countries: countryOverride.length ? countryOverride : base.countries,
      regions: regionOverride.length ? regionOverride : base.regions,
      markets: marketOverride.length ? marketOverride : base.markets,
      venue_types: venueOverride.length ? venueOverride : base.venue_types,
      development_categories: categoryOverride.length ? categoryOverride : base.development_categories,
      streams: streamOverride.length ? streamOverride : base.streams,
    };
  }, [
    storedScope,
    countryOverride,
    regionOverride,
    marketOverride,
    venueOverride,
    categoryOverride,
    streamOverride,
  ]);

  // WHAT MAY BE OFFERED ON AN AXIS. A stored constraint is a ceiling: a client
  // scoped to two categories can be narrowed to one of those two and never
  // widened to a third. An unconstrained axis offers the whole vocabulary,
  // because selecting from it is still a narrowing of "everything".
  const allowed = useCallback(
    (stored: string[] | null | undefined, vocabulary: readonly string[]): readonly string[] =>
      stored && stored.length ? stored : vocabulary,
    []
  );

  const brandName = brandOverride || client?.brand_name || 'Philip Kwong';
  const addressee = addresseeOverride || client?.addressee || client?.name || 'Internal';

  // EVERY AXIS THE SCOPE CONSTRAINS IS IN THE KEY. Keying on markets and stages
  // alone meant a scope narrowed by venue, category or stream returned the
  // previous scope's document from cache - a preview that quietly disagreed
  // with what generation would produce.
  const scopeKey = JSON.stringify([
    effectiveScope.countries,
    effectiveScope.regions,
    effectiveScope.markets,
    effectiveScope.stages,
    effectiveScope.development_categories,
    effectiveScope.venue_types,
    effectiveScope.streams,
    effectiveScope.pipeline_id,
  ]);

  const choices = useQuery({
    queryKey: ['report', 'choices', effectiveScope.id, scopeKey],
    queryFn: () => listScopeProjects(effectiveScope),
  });
  const projectChoices = choices.data ?? [];

  const built = useQuery({
    queryKey: [
      'report',
      'build',
      effectiveScope.id,
      scopeKey,
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
      detailCap,
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
        detailCap,
        projectId: projectId || null,
        geographyLabel: projectId
          ? (projectChoices.find((p) => p.id === projectId)?.name ?? 'one project')
          : geographyLabel(effectiveScope),
      }),
  });

  const doc = built.data?.doc;
  const tally = doc ? provenanceTally(doc) : null;
  // Mirrors assertBasis in lib/report-model, which is what actually refuses.
  const contradictoryBasis = !!doc && doc.projectCount > 0 && doc.recordCount === 0;
  const hasCommentary = Object.values(commentary).some((v) => v.trim().length > 0);

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
          // THE WHOLE SCOPE, not the two axes that happened to be filled in
          // when this was written. The delivery row is the record of what a
          // client was covered for; one that omits the venue, category and
          // stream constraints the document was actually built under cannot
          // answer the question it exists to answer.
          scope: {
            pipeline_id: effectiveScope.pipeline_id,
            countries: effectiveScope.countries,
            regions: effectiveScope.regions,
            markets: effectiveScope.markets,
            stages: effectiveScope.stages,
            development_categories: effectiveScope.development_categories,
            venue_types: effectiveScope.venue_types,
            streams: effectiveScope.streams,
            projectId: projectId || null,
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
          {/* A DROPDOWN WITH ONE ENTRY IN IT HAS TO SAY WHY.
              A failed clients query and a database with no clients in it
              rendered identically here: "No client (internal)" and nothing
              else. The screen then invites an internal report for a client who
              is sitting in the table, and nothing on screen suggests anything
              went wrong. Both states are now named. */}
          {clients.isError ? (
            <span className={styles.error} role="alert" data-testid="report-client-error">
              Clients could not be read, so this list is empty for a reason that
              is not "there are none": {(clients.error as Error).message}
            </span>
          ) : clients.isPending ? (
            <span className={styles.hint}>Loading clients...</span>
          ) : (clients.data ?? []).length === 0 ? (
            <span className={styles.hint}>
              No clients on record. Onboard one on Clients before generating for
              a client.
            </span>
          ) : null}
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

        {/* GEOGRAPHY. Three levels, each multi-select, any combination. */}
        {(
          [
            ['Narrow to countries', countryOverride, setCountryOverride,
              storedScope?.countries, countryFacet, 'country'],
            ['Narrow to regions and states', regionOverride, setRegionOverride,
              storedScope?.regions, regionFacet, 'region'],
            ['Narrow to markets', marketOverride, setMarketOverride,
              storedScope?.markets, marketFacet, 'market'],
          ] as const
        ).map(([label, selected, setSelected, stored, facet, testKey]) => {
          const counts: FacetCount[] = facet.data?.counts ?? [];
          const fromCorpus = counts.map((c) => c.value);
          // A stored constraint is a ceiling: a client scoped to sixteen markets
          // can be narrowed to three of those sixteen and never widened to a
          // seventeenth. An unconstrained axis offers everything the register
          // holds, because selecting from it is still a narrowing.
          const options = allowed(stored, fromCorpus);
          const countOf = (v: string) => counts.find((c) => c.value === v)?.count;
          return (
            <div className={styles.field} key={testKey}>
              <span className={styles.label}>{label}</span>
              <span className={styles.hint}>
                {selected.length > 0
                  ? `${selected.length} selected. This report only; the client's stored scope is unchanged.`
                  : stored && stored.length
                    ? `The client's stored constraint applies: ${stored.join(', ')}.`
                    : 'No constraint on this level.'}
              </span>
              <div className={styles.chips} data-testid={`report-${testKey}-chips`}>
                {options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    data-report-option={o}
                    className={`${styles.chip} ${selected.includes(o) ? styles.chipOn : ''}`}
                    onClick={() =>
                      setSelected(
                        selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]
                      )
                    }
                  >
                    {o}
                    {countOf(o) !== undefined && <span className="mono"> {countOf(o)}</span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {/* THE OTHER THREE SCOPE AXES. Printed on the cover and applied by the
            generator, so what the document says it covers and what it contains
            are built from one object. */}
        {(
          [
            ['Narrow to development categories', categoryOverride, setCategoryOverride,
              storedScope?.development_categories, DEVELOPMENT_CATEGORIES, 'category'],
            ['Narrow to venue types', venueOverride, setVenueOverride,
              storedScope?.venue_types, VENUE_TYPES, 'venue'],
            ['Narrow to capture streams', streamOverride, setStreamOverride,
              storedScope?.streams, STREAMS, 'stream'],
          ] as const
        ).map(([label, selected, setSelected, stored, vocabulary, testKey]) => (
          <div className={styles.field} key={testKey}>
            <span className={styles.label}>{label}</span>
            <span className={styles.hint}>
              {selected.length > 0
                ? `${selected.length} selected. This report only.`
                : stored && stored.length
                  ? `The client's stored constraint applies: ${stored.join(', ')}.`
                  : 'No constraint. Everything in scope on this axis.'}
            </span>
            <div className={styles.chips} data-testid={`report-${testKey}-chips`}>
              {allowed(stored, vocabulary).map((o) => (
                <button
                  key={o}
                  type="button"
                  data-report-option={o}
                  className={`${styles.chip} ${selected.includes(o) ? styles.chipOn : ''}`}
                  onClick={() =>
                    setSelected(
                      selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]
                    )
                  }
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* SELECTION, NOT LENGTH. This is the number of projects the document
            describes in full; the rest are counted in the by-market section and
            can be named by adding the remainder appendix. It is a control
            rather than a constant because what reads well depends on what an
            entry costs in page space, and the July standard ran considerably
            more than the default. */}
        <label className={styles.field}>
          <span className={styles.label}>Projects described in full</span>
          <input
            className={styles.input}
            data-testid="report-detail-cap"
            type="number"
            min={1}
            step={1}
            value={detailCapText}
            onChange={(e) => setDetailCapText(e.target.value)}
          />
          <span className={styles.hint}>
            The most significant {detailCap} projects in scope get a full entry.
            {built.data
              ? ` ${built.data.selection.counted} further in scope ${built.data.selection.counted === 1 ? 'is' : 'are'} counted but not described` +
                (built.data.selection.silent
                  ? `, and ${built.data.selection.silent} filed nothing in this period.`
                  : '.')
              : ''}
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

        {/* A REFERRAL WITH NO ASSESSMENT IS A RECORD DUMP, and the screen says
            so rather than filling the gap. Nothing here writes an assessment on
            Philip's behalf: an unwritten judgement is left unwritten, because
            the alternative is a paragraph under his name that he did not say
            and cannot defend. */}
        {projectId && !hasCommentary && (
          <p className={styles.hint} data-testid="referral-no-assessment">
            No assessment written. This brief will go out as records and links
            only - the commentary boxes are where your read goes, and nothing
            will be written there for you.
          </p>
        )}

        {/* THE BASIS CONTRADICTION, BEFORE THE CLICK.
            The generate route refuses this document, and refusing after the
            operator has asked for it is the right backstop but the wrong first
            line: they still had to ask, wait, and read an error. The condition
            is visible in the preview counts, so it is said here, with the cause
            named, and the buttons are disabled. */}
        {contradictoryBasis && (
          <p className={styles.error} role="alert" data-testid="basis-refusal">
            This scope holds {doc?.projectCount} projects and 0 records for {doc?.scope.period}.
            Every section would read &quot;no filing in this period&quot; under a cover
            claiming {doc?.projectCount} projects, so this document will not generate.
            Widen the period, or narrow the scope to match it.
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={!doc || busy || contradictoryBasis} data-testid="gen-pdf" onClick={() => generate('pdf')}>
            {busy ? 'Working...' : 'Generate PDF'}
          </button>
          <button type="button" className={styles.ghost} disabled={!doc || busy || contradictoryBasis} data-testid="gen-csv" onClick={() => generate('csv')}>
            CSV
          </button>
          <button type="button" className={styles.ghost} disabled={!doc || busy || contradictoryBasis} data-testid="gen-xlsx" onClick={() => generate('xlsx')}>
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
                <div key={k} className={styles.scopeRow} data-scope-row={k}>
                  <span className={styles.scopeKey}>{k}</span>
                  <span data-scope-value={k}>{v}</span>
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

                {/* THE ENTRIES. Capped for the preview only - the generated
                    document carries all of them - and the cap says so, because
                    a preview that silently shows less than it will print is the
                    same silent-omission failure at a smaller scale. */}
                {(sec.entries ?? []).slice(0, 12).map((e) => (
                  <div key={e.id} className={styles.entry} data-entry={e.id}>
                    <div className={styles.entryHead}>
                      <h4 className={styles.entryName}>{e.name}</h4>
                      {e.meta && <span className={styles.entryMeta}>{e.meta}</span>}
                    </div>
                    {e.summary && (
                      <>
                        <p className={styles.entryDesc} data-entry-summary>{e.summary.text}</p>
                        <span className={styles.entryCite}>quoted from the filing</span>
                      </>
                    )}
                    {e.assembled && (
                      <p className={styles.entryAssembled} data-entry-assembled>{e.assembled}</p>
                    )}
                    {e.records.map((r, i) => (
                      <div key={i} className={styles.entryRec}>
                        <span className={styles.tag}>[{r.provenance}]</span>
                        <span className={styles.entryRecBody}>
                          {r.date && <b>{r.date}. </b>}
                          {r.reference && <b>{r.reference}: </b>}
                          {r.text}
                          {r.figures.length > 0 && (
                            <div className={styles.entryRecDetail}>{r.figures.join(' | ')}</div>
                          )}
                          {r.language && <div className={styles.entryRecDetail}>{r.language}</div>}
                          {r.players.length > 0 && (
                            <div className={styles.entryRecDetail}>
                              Players: {r.players.map((p) => `${p.name} (${p.role})`).join('; ')}
                            </div>
                          )}
                          {r.contact && <div className={styles.entryRecDetail}>{r.contact}</div>}
                          <div className={styles.lineSource}>{r.sourceLabel}</div>
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
                {(sec.entries?.length ?? 0) > 12 && (
                  <p className={styles.entryHeld}>
                    {(sec.entries?.length ?? 0) - 12} further project entries in the
                    generated document.
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
