'use client';

// THE TOP BAR. 48px, four things, nothing else.
//
// Brand mark, pipeline switcher, global search, world clock. Every one of them
// is global: nothing that belongs to a single screen may appear here, because
// the moment it does the bar stops being learnable and starts being read.
//
// Sign-out and the theme control are deliberately NOT here. They are account
// furniture, used once a session, and putting them in the bar would make it
// five things and then six. They live at the foot of the rail.
//
// The brand mark and the switcher both resolve from the pipeline registry. No
// component in this tree contains the word GLI, or any pipeline name at all.

import Link from 'next/link';
import { useActivePipeline } from '@/lib/use-pipeline';
import WorldClock from './WorldClock';
import styles from './TopBar.module.css';

export default function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { pipeline, options, brand, resolving, setPipeline } = useActivePipeline();

  return (
    <header className={styles.bar}>
      <Link href="/register" className={styles.brand} aria-label={brand.wordmark}>
        <span className={styles.operator}>{brand.wordmark.split(' / ')[0]}</span>
        <span className={styles.slash}>/</span>
        <span className={styles.pipeline}>{brand.pipelineShort}</span>
      </Link>

      {/* One active pipeline today, so a select would be a control with a single
          option. The name is shown instead, and the switcher appears the moment
          a second pipeline goes active. No component changes when it does. */}
      {options.length > 1 ? (
        <label className={styles.switcher}>
          <span className={styles.srOnly}>Pipeline</span>
          <select
            value={pipeline.id}
            onChange={(e) => setPipeline(e.target.value)}
            disabled={resolving}
          >
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className={styles.pipelineStatic} title={brand.pipelineName}>
          {brand.pipelineName}
        </span>
      )}

      {/* Not an input. It is the palette's trigger, and it says so, because a
          field that steals focus into a dialog is worse than a button. */}
      <button type="button" className={styles.search} onClick={onOpenPalette}>
        <span className={styles.searchText}>Search projects and screens</span>
        <kbd className={styles.kbd}>&#8984;K</kbd>
      </button>

      <WorldClock />
    </header>
  );
}
