'use client';

// THE REGISTER'S CONTEXTUAL NAVIGATION, rendered into the shell rail.
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
  count: number;
}

export default function RegisterRail({
  views,
  view,
  onView,
  countries,
  regions,
  markets,
  geo,
  onGeo,
  savedViews,
  activeSaved,
  onSaved,
}: {
  views: CountedView[];
  view: string;
  onView: (key: string) => void;
  countries: GeoLevel[];
  regions: GeoLevel[];
  markets: GeoLevel[];
  geo: { country?: string; region_state?: string; market?: string };
  onGeo: (next: { country?: string; region_state?: string; market?: string }) => void;
  savedViews: { key: string; label: string }[];
  activeSaved: string;
  onSaved: (key: string) => void;
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

      <RailSection title="Geography">
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
                  className={`${styles.railItem} ${open && !geo.region_state ? styles.railItemActive : ''}`}
                  onClick={() => onGeo(open ? {} : { country: c.value })}
                >
                  <span className={styles.railLabel}>{c.value}</span>
                  <span className={`${styles.railCount} mono`}>{c.count}</span>
                </button>

                {open &&
                  regions.map((r) => {
                    const rOpen = geo.region_state === r.value;
                    return (
                      <div key={r.value}>
                        <button
                          type="button"
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
                          <span className={`${styles.railCount} mono`}>{r.count}</span>
                        </button>

                        {rOpen &&
                          markets.map((m) => (
                            <button
                              key={m.value}
                              type="button"
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
                              <span className={`${styles.railCount} mono`}>{m.count}</span>
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
        </div>
      </RailSection>
    </>
  );
}
