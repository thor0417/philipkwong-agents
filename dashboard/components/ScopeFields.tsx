'use client';

// THE SCOPE CONTROLS. Used by the intake form and by the inline editor on the
// client detail, because they must produce identical scopes: two forms writing
// the same table is how one of them ends up with a field the other forgets.
//
// GEOGRAPHY AND MARKETS COME FROM THE FACETS, NOT FROM A TYPED STRING.
//
// This is the single most important decision in the intake form. A scope
// matching nothing is almost always a spelling: "Las Vegas NV" instead of "Las
// Vegas", "Clark Co." instead of "Clark County". A free-text market field
// guarantees that failure eventually and gives no signal when it happens - the
// form looks complete and the report comes out empty.
//
// So every geography option is a value the register actually holds, read from
// the same faceted counts the Register's rail uses, with the count shown beside
// it. A market with 44 projects and a market with 0 look different at the moment
// of choosing, which is the moment the mistake is cheapest to avoid.

import { DEVELOPMENT_CATEGORIES, PROJECT_STAGES, VENUE_TYPES } from '@/lib/taxonomy';
import { useProjectFacet } from '@/lib/use-projects';
import { HOSPITALITY_ID, storageKeyFor } from '@/lib/pipelines';
import styles from '@/app/(app)/clients/page.module.css';

export interface ScopeDraft {
  pipeline_id: string;
  countries: string[];
  regions: string[];
  markets: string[];
  streams: string[];
  development_categories: string[];
  venue_types: string[];
  stages: string[];
  watch_terms: string[];
  notes: string;
}

export const EMPTY_SCOPE: ScopeDraft = {
  pipeline_id: HOSPITALITY_ID,
  countries: [],
  regions: [],
  markets: [],
  streams: [],
  development_categories: [],
  venue_types: [],
  stages: [],
  watch_terms: [],
  notes: '',
};

export const STREAMS = ['government', 'intelligence', 'opportunity'] as const;

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function ChipField({
  label,
  hint,
  options,
  selected,
  onToggle,
}: {
  label: string;
  hint: string;
  options: { value: string; count?: number }[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <span className={styles.hint}>
        {selected.length === 0 ? `${hint} Nothing selected means no constraint.` : hint}
      </span>
      <div className={styles.chips}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            data-scope-option={o.value}
            className={`${styles.chip} ${selected.includes(o.value) ? styles.chipOn : ''}`}
            onClick={() => onToggle(o.value)}
          >
            {o.value}
            {o.count !== undefined && <span className="mono"> {o.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ScopeFields({
  draft,
  onChange,
}: {
  draft: ScopeDraft;
  onChange: (next: ScopeDraft) => void;
}) {
  const base = { module: storageKeyFor(HOSPITALITY_ID), excludeStatus: 'dismissed' as const };
  const countries = useProjectFacet(base, 'country');
  // The region and market facets narrow to what is chosen above them, so the
  // options offered are reachable: a market list showing every market in the
  // corpus while a country is selected offers combinations that match nothing.
  const regions = useProjectFacet(
    { ...base, country: draft.countries.length === 1 ? draft.countries[0] : undefined },
    'region_state'
  );
  const markets = useProjectFacet(
    {
      ...base,
      country: draft.countries.length === 1 ? draft.countries[0] : undefined,
      region_state: draft.regions.length === 1 ? draft.regions[0] : undefined,
    },
    'market'
  );

  const set = (patch: Partial<ScopeDraft>) => onChange({ ...draft, ...patch });

  return (
    <>
      <ChipField
        label="Countries"
        hint="From the register's own values."
        options={(countries.data?.counts ?? []).map((c) => ({ value: c.value, count: c.count }))}
        selected={draft.countries}
        onToggle={(v) => set({ countries: toggle(draft.countries, v) })}
      />
      <ChipField
        label="Regions and states"
        hint="Narrows to the selected country."
        options={(regions.data?.counts ?? []).map((c) => ({ value: c.value, count: c.count }))}
        selected={draft.regions}
        onToggle={(v) => set({ regions: toggle(draft.regions, v) })}
      />
      <ChipField
        label="Markets"
        hint="The count is what the register holds today."
        options={(markets.data?.counts ?? []).map((c) => ({ value: c.value, count: c.count }))}
        selected={draft.markets}
        onToggle={(v) => set({ markets: toggle(draft.markets, v) })}
      />
      <ChipField
        label="Development categories"
        hint="What kind of development."
        options={DEVELOPMENT_CATEGORIES.map((v) => ({ value: v }))}
        selected={draft.development_categories}
        onToggle={(v) => set({ development_categories: toggle(draft.development_categories, v) })}
      />
      <ChipField
        label="Venue types"
        hint="What is being built."
        options={VENUE_TYPES.map((v) => ({ value: v }))}
        selected={draft.venue_types}
        onToggle={(v) => set({ venue_types: toggle(draft.venue_types, v) })}
      />
      <ChipField
        label="Stages"
        hint="Where in the ladder a project has to be."
        options={PROJECT_STAGES.map((v) => ({ value: v }))}
        selected={draft.stages}
        onToggle={(v) => set({ stages: toggle(draft.stages, v) })}
      />
      <ChipField
        label="Streams"
        hint="Which capture lane."
        options={STREAMS.map((v) => ({ value: v }))}
        selected={draft.streams}
        onToggle={(v) => set({ streams: toggle(draft.streams, v) })}
      />

      <div className={styles.field}>
        <span className={styles.label}>Watch terms</span>
        <span className={styles.hint}>
          Comma separated. These are not a report filter: they are issued as
          unrestricted searches by the capture layer, so a term here changes what
          the system collects. Terms under four characters and bare surnames are
          dropped by the agent and reported.
        </span>
        <input
          className={styles.input}
          data-testid="scope-watch-terms"
          value={draft.watch_terms.join(', ')}
          onChange={(e) =>
            set({
              watch_terms: e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
          placeholder="OCVibe, Kulik River Capital, Simtec"
        />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Scope notes</span>
        <span className={styles.hint}>
          Context that is not a filter. Anything that belongs in the query goes
          in the fields above, where it can be counted.
        </span>
        <textarea
          className={styles.textarea}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </div>
    </>
  );
}
