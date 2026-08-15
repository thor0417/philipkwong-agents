'use client';

// PLAYERS. Every company we have named, browsable.
//
// Player extraction is the differentiator of this product and the company page
// was reachable only by drilling through a project - so the graph could be read
// one node at a time, starting from a node you already knew about. That is not a
// graph, it is a footnote.
//
// THE THREE THINGS THIS LIST IS FOR, in the order they matter:
//
//   MARKETS  A firm filing in three markets is the finding. It is the first
//            column, the default sort, and the reason to open this screen.
//   REACH    Whether any of the firm's projects carries an email or a phone.
//            26 companies of 182 do. Those are the commercially valuable rows
//            and a list that does not mark them buries the thing worth selling.
//   ROLES    Applicant, representative, owner, presenter. A firm holding two is
//            a firm that turns up on both sides.
//
// Opening a row opens the existing company page unchanged. Nothing here is a
// second company screen.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryState, parseAsString } from 'nuqs';
import { usePlayers } from '@/lib/use-companies';
import { LIVE_PIPELINE_STORAGE_KEY } from '@/lib/pipelines';
import type { Player } from '@/lib/companies';
import styles from './page.module.css';

type SortKey = 'markets' | 'projects' | 'name' | 'last_activity' | 'first_seen';

const COLUMNS: { key: SortKey | 'roles' | 'reach'; label: string; sort?: SortKey; help?: string }[] = [
  { key: 'name', label: 'Company', sort: 'name' },
  {
    key: 'markets',
    label: 'Markets',
    sort: 'markets',
    help: 'How many distinct markets this company has filed in. More than one is the finding.',
  },
  { key: 'projects', label: 'Projects', sort: 'projects', help: 'Live projects it is attached to.' },
  { key: 'roles', label: 'Roles' },
  {
    key: 'reach',
    label: 'Reach',
    help: 'Whether any of its projects carries an email or a phone on a record.',
  },
  { key: 'first_seen', label: 'First seen', sort: 'first_seen' },
  { key: 'last_activity', label: 'Last activity', sort: 'last_activity' },
];

function ymd(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '--';
}

function compare(a: Player, b: Player, key: SortKey): number {
  switch (key) {
    case 'markets':
      return b.markets.length - a.markets.length || b.projects - a.projects;
    case 'projects':
      return b.projects - a.projects || b.markets.length - a.markets.length;
    case 'name':
      return a.name.localeCompare(b.name);
    case 'first_seen':
      return (b.first_seen ?? '').localeCompare(a.first_seen ?? '');
    case 'last_activity':
      return (b.last_activity ?? '').localeCompare(a.last_activity ?? '');
  }
}

export default function PlayersPage() {
  const [term, setTerm] = useState('');
  const [sort, setSort] = useQueryState('sort', parseAsString.withDefault('markets'));
  const [dir, setDir] = useQueryState('dir', parseAsString.withDefault('desc'));
  const players = usePlayers(LIVE_PIPELINE_STORAGE_KEY);

  const all = useMemo(() => players.data ?? [], [players.data]);

  // The three numbers this screen is judged on, computed over everything rather
  // than over the filtered page: a header that moves when you type is a header
  // that cannot be quoted.
  const stats = useMemo(() => {
    const attached = all.filter((p) => p.projects > 0);
    return {
      total: all.length,
      attached: attached.length,
      multiRole: attached.filter((p) => p.roles.length > 1).length,
      multiMarket: attached.filter((p) => p.markets.length > 1).length,
      reachable: attached.filter((p) => p.reachable).length,
    };
  }, [all]);

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const filtered = needle
      ? all.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) ||
            p.markets.some((m) => m.toLowerCase().includes(needle)) ||
            p.roles.some((r) => r.toLowerCase().includes(needle))
        )
      : all;
    const key = (['markets', 'projects', 'name', 'first_seen', 'last_activity'] as SortKey[]).includes(
      sort as SortKey
    )
      ? (sort as SortKey)
      : 'markets';
    const sorted = [...filtered].sort((a, b) => compare(a, b, key));
    return dir === 'asc' ? sorted.reverse() : sorted;
  }, [all, term, sort, dir]);

  const sortBy = (key: SortKey) => {
    if (sort === key) void setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      void setSort(key);
      void setDir('desc');
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <h1 className={styles.title}>Players</h1>
        <input
          className={styles.search}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Company, market or role"
          aria-label="Search players"
        />
      </div>

      <p className={styles.stats} data-testid="players-stats">
        <span className="mono">{stats.total}</span> companies,{' '}
        <span className="mono">{stats.attached}</span> on a live project.{' '}
        <span className="mono">{stats.multiMarket}</span> appear in more than one market,{' '}
        <span className="mono">{stats.multiRole}</span> hold more than one role,{' '}
        <span className="mono">{stats.reachable}</span> carry a contact path.
      </p>

      {/* THE FINDING THIS SCREEN WAS BUILT FOR IS CURRENTLY ABSENT, AND IT SAYS
          SO. Zero companies appear in more than one market. That is a statement
          about the graph, not about the screen, and hiding it behind an ordinary
          empty column would be the same failure as a market node reading 0 with
          no explanation. Rendered only while it is true. */}
      {!players.isPending && stats.multiMarket === 0 && stats.attached > 0 && (
        <p className={styles.finding} data-testid="players-no-cross-market">
          No company in this graph appears in more than one market. Cross-market
          presence is what this list is for, so its absence is the finding: with{' '}
          <span className="mono">{stats.attached}</span> companies over{' '}
          <span className="mono">{stats.total}</span> rows, the extractor is naming
          parties one filing at a time and never recognising the same firm twice
          in two places.
        </p>
      )}

      <div className={styles.table}>
        <div className={styles.headRow} role="row" data-testid="players-head-row">
          {COLUMNS.map((c) => (
            <button
              key={c.key}
              type="button"
              title={c.help}
              data-column={c.key}
              className={`${styles.colHead} ${sort === c.sort ? styles.colHeadActive : ''}`}
              onClick={() => c.sort && sortBy(c.sort)}
            >
              {c.label}
              {sort === c.sort && (
                <span className={`${styles.sortMark} mono`} aria-hidden="true">
                  {dir === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </button>
          ))}
        </div>

        {players.isPending ? (
          <p className={styles.dim}>Loading...</p>
        ) : rows.length === 0 ? (
          <p className={styles.dim}>No company matches that.</p>
        ) : (
          rows.map((p) => (
            <Link
              key={p.id}
              href={`/company/${p.id}`}
              className={styles.row}
              role="row"
              data-company-id={p.id}
            >
              <span className={styles.cellName}>{p.name}</span>
              {/* The markets themselves, not only the count. "2" tells you a
                  firm is worth opening; "Clark County, Las Vegas" tells you
                  why. */}
              <span className={styles.cellMarkets}>
                <span className={`${styles.num} mono`}>{p.markets.length}</span>
                {p.markets.length > 0 && (
                  <span className={styles.marketList}>{p.markets.join(', ')}</span>
                )}
              </span>
              <span className={`${styles.num} mono`}>{p.projects}</span>
              <span className={styles.cellRoles}>{p.roles.join(', ') || '--'}</span>
              <span className={styles.cellReach} data-reachable={p.reachable ? 'yes' : 'no'}>
                {p.reachable ? 'contactable' : ''}
              </span>
              <span className={`${styles.num} mono`}>{ymd(p.first_seen)}</span>
              <span className={`${styles.num} mono`}>{ymd(p.last_activity)}</span>
            </Link>
          ))
        )}
      </div>

      <p className={styles.foot}>
        A company with no live project keeps its row: it was named on a filing we
        later dismissed, or on a project that was. Nothing here is deleted.
      </p>
    </div>
  );
}
