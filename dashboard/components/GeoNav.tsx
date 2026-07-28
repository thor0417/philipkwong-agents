'use client';

import type { FacetCount } from '@/lib/query';

// GEOGRAPHIC NAVIGATION. Country, then state or province, then market, with a
// count at every level. Every count comes from the database (one grouped query
// per level), never from counting loaded rows, so this holds at 25 markets.
//
// Selecting a level filters the paginated table below and reveals the next level
// down. Records that resolved only to a country appear in a labelled bucket at
// that country's level rather than disappearing from navigation: partial
// geography is a result, not a failure.
export default function GeoNav({
  countries,
  regions,
  markets,
  country,
  regionState,
  market,
  unresolved,
  onSelect,
  viaRpc,
}: {
  countries: FacetCount[];
  regions: FacetCount[];
  markets: FacetCount[];
  country?: string;
  regionState?: string;
  market?: string;
  // Rows in scope whose country never resolved.
  unresolved: number;
  onSelect: (next: { country?: string; region_state?: string; market?: string }) => void;
  viaRpc: boolean;
}) {
  const Level = ({
    label,
    items,
    selected,
    onPick,
    onClear,
  }: {
    label: string;
    items: FacetCount[];
    selected?: string;
    onPick: (v: string) => void;
    onClear: () => void;
  }) => (
    <div className="geoLevel">
      <span className="geoLabel">{label}</span>
      <div className="geoChips">
        <button
          className={`geoChip ${!selected ? 'geoChipActive' : ''}`}
          onClick={onClear}
        >
          All
          <span className="geoCount">{items.reduce((a, c) => a + c.count, 0)}</span>
        </button>
        {items.map((c) => (
          <button
            key={c.value}
            className={`geoChip ${selected === c.value ? 'geoChipActive' : ''}`}
            onClick={() => onPick(c.value)}
          >
            {c.value}
            <span className="geoCount">{c.count}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <section className="geoNav">
      <Level
        label="Country"
        items={countries}
        selected={country}
        onPick={(v) => onSelect({ country: v })}
        onClear={() => onSelect({})}
      />
      {country && (
        <Level
          label="State / Region"
          items={regions}
          selected={regionState}
          onPick={(v) => onSelect({ country, region_state: v })}
          onClear={() => onSelect({ country })}
        />
      )}
      {country && regionState && (
        <Level
          label="Market"
          items={markets}
          selected={market}
          onPick={(v) => onSelect({ country, region_state: regionState, market: v })}
          onClear={() => onSelect({ country, region_state: regionState })}
        />
      )}
      {unresolved > 0 && (
        <div className="geoUnresolved">
          {unresolved} record{unresolved === 1 ? '' : 's'} in this view have no resolved country
          and are not reachable from the levels above. They remain in the table when no
          geography filter is applied.
        </div>
      )}
      {!viaRpc && (
        <div className="geoUnresolved">
          Level counts are using the interim path. Apply migration 015 (facet_counts)
          to move the grouping into Postgres.
        </div>
      )}
    </section>
  );
}
