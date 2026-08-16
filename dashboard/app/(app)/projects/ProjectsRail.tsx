'use client';

// THE PROJECTS SCREEN'S CONTEXTUAL NAVIGATION, rendered into the shell rail.
//
// Views, then geography as a tree, then saved views. All three are filters, and
// all three live in the rail rather than above the table because a filter bar
// above a list steals the vertical space the list is there to use. The rail is
// already 200px of chrome the operator has learned; putting the filters in it
// costs nothing.
//
// Counts are LIVE and server-side. A view labelled with a number the operator
// cannot get to by clicking it is worse than no number, so every count here is
// the same query the view runs, minus its own axis.

import RailSection from '@/components/shell/RailSection';
import styles from './page.module.css';

export interface CountedView {
  key: string;
  label: string;
  count: number | undefined;
}

export interface GeoLevel {
  value: string;
  // PROJECTS, AND SPECIFICALLY THE ONES CLICKING THIS NODE RETURNS. Every level
  // is now counted by the same rule its click is resolved by: country and region
  // off the project column, market through the records. There is no second
  // number, because the second number was the whole corpus for that geography
  // and it sat in the same row as a fully filtered one.
  count: number;
}

function GeoCounts({ level }: { level: GeoLevel }) {
  return (
    <span className={styles.railCounts}>
      <span className={`${styles.railCount} mono`}>{level.count}</span>
    </span>
  );
}

/** A covered market as the rail needs it: where it is, what state it is in. */
export interface CoveredMarketNode {
  market: string;
  regionState: string;
  country: string;
  projects: number;
  state: string;
  why: string;
}

export default function ProjectsRail({
  views,
  view,
  onView,
  covered,
  pressCount,
  pressOpen,
  onTogglePress,
  countries,
  regions,
  markets,
  geo,
  onGeo,
  savedViews,
  activeSaved,
  onSaved,
  clientViews,
  activeClient,
  onClient,
}: {
  views: CountedView[];
  view: string;
  onView: (key: string) => void;
  covered: CoveredMarketNode[];
  pressCount: number | undefined;
  pressOpen: boolean;
  onTogglePress: () => void;
  countries: GeoLevel[];
  regions: GeoLevel[];
  markets: GeoLevel[];
  geo: { country?: string; region_state?: string; market?: string };
  onGeo: (next: { country?: string; region_state?: string; market?: string }) => void;
  savedViews: { key: string; label: string }[];
  activeSaved: string;
  onSaved: (key: string) => void;
  clientViews: { id: string; name: string }[];
  activeClient: string | null;
  onClient: (id: string | null) => void;
}) {
  // The tree is collapsed except along the active branch: regions appear only
  // once a country is chosen, markets only once a region is. Rendering all
  // three levels at once is how a 200px rail becomes a 2000px scroll.
  return (
    <>
      <RailSection title="Views">
        <div className={styles.railList}>
          {views.map((v) => (
            <button
              key={v.key}
              type="button"
              className={`${styles.railItem} ${view === v.key ? styles.railItemActive : ''}`}
              aria-current={view === v.key ? 'true' : undefined}
              onClick={() => onView(v.key)}
            >
              <span className={styles.railLabel}>{v.label}</span>
              <span className={`${styles.railCount} mono`}>{v.count ?? '--'}</span>
            </button>
          ))}
        </div>
      </RailSection>

      {/* SAVED VIEWS AND CLIENT VIEWS ARE ONE SECTION, BECAUSE THEY ARE ONE
          KIND OF THING. use-client-view.ts opens with the sentence this merge
          is built on: a client is a saved view you open, not a screen you
          visit. Both are a set of filters worth one click, both land on this
          same table with the same columns and the same keyboard, and they sat
          in two different places - the four combinations here, the clients on
          another screen entirely.

          THE ONE THING THAT MUST NOT MERGE IS WHAT THEY MEAN. "Anaheim" is a
          filter; JKR & Associates is a person's coverage, with confirmed
          membership behind it and a document generated from it. A row that
          looked identical to Anaheim but could be sent to a client would be
          the most expensive kind of sameness in this product, so a client row
          is marked as one and says so on hover. */}
      <RailSection title="Saved views">
        <div className={styles.railList}>
          {savedViews.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`${styles.railItem} ${activeSaved === s.key ? styles.railItemActive : ''}`}
              onClick={() => onSaved(s.key)}
            >
              <span className={styles.railLabel}>{s.label}</span>
            </button>
          ))}

          {clientViews.map((c) => (
            <button
              key={c.id}
              type="button"
              data-client-view={c.id}
              title={
                `${c.name}'s stored scope. Unlike the filter combinations above, ` +
                'this is a client\'s coverage: it carries confirmed membership and ' +
                'is what their documents are built from.'
              }
              className={`${styles.railItem} ${activeClient === c.id ? styles.railItemActive : ''}`}
              onClick={() => onClient(activeClient === c.id ? null : c.id)}
            >
              <span className={styles.railLabel}>{c.name}</span>
              <span className={styles.railKind}>client</span>
            </button>
          ))}
        </div>
      </RailSection>

      {/* COVERED MARKETS ARE LAST, AND THAT IS THE ANSWER TO THE OVERFLOW.
          Measured at 1080: the rail held 1335px of content in a 928px column,
          so 407px of it could only be reached by scrolling. Folding the
          reference group, dissolving the press section into this list and
          tightening the row height took it to 1005px, and the last 77px cannot
          be taken without either dropping a market or shrinking a click target
          below what a person can hit.
          So it is not taken - it is ORDERED. Every other section is a fixed
          length; this one grows with the business, and lib/coverage sorts it by
          severity, so a dead market is at the top and the tail is the smallest
          market that is working fine. Putting it last means what falls below
          the fold is coverage nobody needs to be told about, and the same
          principle that makes `live` quiet decides what scrolls.

          COVERED MARKETS ARE NOT THE SAME KIND OF THING AS EVERYWHERE ELSE.
          A tree listing sixty-five countries with counts beside them reads as
          coverage. Thirteen of those places have a government-lane adapter
          pointed at them; every other entry is where a press story happened to
          land. Shown as one list they are indistinguishable, and that is how a
          market name reaches a client's cover page on the strength of one
          headline.
          So the covered markets are their own section, each carrying the state
          it is actually in - live, degraded, stale, thin or dead - and the rest
          of the world is one collapsed node below, labelled as press coverage.
          The states come from lib/coverage, which is also what the Health screen
          reads, so the two cannot disagree. */}
      <RailSection title="Covered markets">
        <div className={styles.railList}>
          {covered.length === 0 && <p className={styles.railLegend}>Reading coverage...</p>}
          {covered.map((m) => (
            <button
              key={m.market}
              type="button"
              data-covered-market={m.market}
              data-coverage-state={m.state}
              title={m.why}
              className={`${styles.railItem} ${geo.market === m.market ? styles.railItemActive : ''}`}
              onClick={() =>
                onGeo(
                  geo.market === m.market
                    ? {}
                    : { country: m.country, region_state: m.regionState, market: m.market }
                )
              }
            >
              <span className={styles.railLabel}>{m.market}</span>
              <span className={styles.railCounts}>
                <span className={styles.railState} data-coverage-state={m.state}>
                  {m.state}
                </span>
                <span className={`${styles.railCount} mono`}>{m.projects}</span>
              </span>
            </button>
          ))}

          {/* PRESS COVERAGE IS THE LAST ROW OF THIS LIST, NOT A SECTION OF ITS
              OWN. It is one collapsed node, and it was carrying a heading, a
              gap and three lines of legend - 180px of a column measured 407px
              short. It belongs here anyway: the question it answers is "and
              what about everywhere else", which is a question about this list.
              The legend it lost said the same thing its label says, so it is
              now the node's title rather than prose in the rail. */}
          <button
            type="button"
            data-testid="press-coverage-toggle"
            className={styles.railItem}
            aria-expanded={pressOpen}
            title={
              'Places a story landed on. No adapter is pointed at any of them, ' +
              'so nothing here is a market we watch. Opening it gives the full ' +
              'country tree.'
            }
            onClick={onTogglePress}
          >
            <span className={styles.railLabel}>
              {pressOpen ? 'Hide' : 'Show'} press-only
            </span>
            <span className={`${styles.railCount} mono`}>{pressCount ?? '--'}</span>
          </button>
        </div>
      </RailSection>

      {pressOpen && (
      <RailSection title="All geography">
        {/* One number, one meaning, no legend needed. */}
        <div className={styles.railList}>
          <button
            type="button"
            className={`${styles.railItem} ${!geo.country ? styles.railItemActive : ''}`}
            onClick={() => onGeo({})}
          >
            <span className={styles.railLabel}>All countries</span>
          </button>

          {countries.map((c) => {
            const open = geo.country === c.value;
            return (
              <div key={c.value}>
                <button
                  type="button"
                  data-country={c.value}
                  className={`${styles.railItem} ${open && !geo.region_state ? styles.railItemActive : ''}`}
                  onClick={() => onGeo(open ? {} : { country: c.value })}
                >
                  <span className={styles.railLabel}>{c.value}</span>
                  <GeoCounts level={c} />
                </button>

                {open &&
                  regions.map((r) => {
                    const rOpen = geo.region_state === r.value;
                    return (
                      <div key={r.value}>
                        <button
                          type="button"
                          data-region={r.value}
                          className={`${styles.railItem} ${styles.railL2} ${
                            rOpen && !geo.market ? styles.railItemActive : ''
                          }`}
                          onClick={() =>
                            onGeo(
                              rOpen
                                ? { country: c.value }
                                : { country: c.value, region_state: r.value }
                            )
                          }
                        >
                          <span className={styles.railLabel}>{r.value}</span>
                          <GeoCounts level={r} />
                        </button>

                        {rOpen &&
                          markets.map((m) => (
                            <button
                              key={m.value}
                              type="button"
                              // The node's own two numbers, as values rather
                              // than as rendered text. filters.audit reads
                              // data-projects to report, per market, the gap
                              // between what this rail counts (projects.market,
                              // the mode column) and what clicking it returns
                              // (any record naming the market). That gap is a
                              // decision to be taken with the numbers in hand,
                              // so the numbers have to be readable.
                              data-market={m.value}
                              data-projects={m.count}
                              className={`${styles.railItem} ${styles.railL3} ${
                                geo.market === m.value ? styles.railItemActive : ''
                              }`}
                              onClick={() =>
                                onGeo(
                                  geo.market === m.value
                                    ? { country: c.value, region_state: r.value }
                                    : { country: c.value, region_state: r.value, market: m.value }
                                )
                              }
                            >
                              <span className={styles.railLabel}>{m.value}</span>
                              <GeoCounts level={m} />
                            </button>
                          ))}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </RailSection>
      )}

    </>
  );
}
