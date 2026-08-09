'use client';

// THE DESIGN SYSTEM, RENDERED.
//
// The whole system on one page, so it can be seen at once and so a drift is
// visible rather than argued about. Two rules govern this file:
//
//  1. It reads no data. It needs no session, so it renders for anyone with the
//     URL and can be screenshotted without an auth dance.
//  2. Every swatch prints its value by reading the COMPUTED custom property off
//     the document, never a hardcoded string. A specimen page that hardcodes its
//     own labels can disagree with the tokens it documents, which makes it worse
//     than no specimen page at all. This one cannot: change a token and the
//     label here changes with it, in both modes.

import { useEffect, useState } from 'react';
import ThemeToggle from '@/components/ThemeToggle';
import styles from './page.module.css';

/* Reads live token values off :root and re-reads whenever the theme changes,
   by explicit toggle (data-theme mutation) or by the OS preference moving. */
function useTokenValues(names: string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const next: Record<string, string> = {};
      for (const n of names) next[n] = cs.getPropertyValue(n).trim();
      setValues(next);
    };
    read();

    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', read);
    return () => {
      observer.disconnect();
      mq.removeEventListener('change', read);
    };
    // names is a module-level constant array at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return values;
}

const PAPER = ['--paper-page', '--paper-card', '--paper-rail'];
const INK = ['--ink', '--ink-secondary', '--ink-muted', '--ink-disabled'];
const ACCENT = ['--accent', '--accent-hover', '--on-accent'];
const SEMANTIC = ['--ok', '--bad'];
const LINES = ['--line', '--line-strong'];
const ALL_COLOURS = [...PAPER, ...INK, ...ACCENT, ...SEMANTIC, ...LINES];

const SPACE = ['--space-4', '--space-8', '--space-12', '--space-16', '--space-24', '--space-32', '--space-48'];

const TYPE_STEPS: { token: string; label: string; face: string; sample: string }[] = [
  { token: '--type-display-lg', label: 'Display 28', face: 'display', sample: 'Hospitality and Entertainment' },
  { token: '--type-display-sm', label: 'Display 22', face: 'display', sample: 'Anaheim resort district' },
  { token: '--type-title-lg', label: 'Title 18', face: 'body-medium', sample: 'What moved this week' },
  { token: '--type-title-sm', label: 'Title 16', face: 'body-medium', sample: 'Needs you' },
  { token: '--type-body', label: 'Body 14', face: 'body', sample: 'A conditional use permit was filed for a 12-storey hotel.' },
  { token: '--type-meta', label: 'Meta 12', face: 'body', sample: 'Applicant, representative, market' },
  { token: '--type-caption', label: 'Caption 11', face: 'body', sample: 'Floor. Nothing sets smaller than this.' },
];

function Section({ n, title, note, children }: { n: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={`${styles.sectionNum} mono`}>{n}</span>
        <h2 className={styles.sectionTitle}>{title}</h2>
      </div>
      {note && <p className={styles.note}>{note}</p>}
      {children}
    </section>
  );
}

function Swatch({ name, value, ring }: { name: string; value: string; ring?: boolean }) {
  return (
    <div className={styles.swatch}>
      <div
        className={`${styles.chipColour} ${ring ? styles.chipRinged : ''}`}
        style={{ background: `var(${name})` }}
      />
      <div className={styles.swatchMeta}>
        <span className={styles.swatchName}>{name.replace('--', '')}</span>
        <span className={`${styles.swatchValue} mono`}>{value || '...'}</span>
      </div>
    </div>
  );
}

export default function DesignSystemPage() {
  const t = useTokenValues([...ALL_COLOURS, ...SPACE]);

  const [selected, setSelected] = useState('r2');
  const [checked, setChecked] = useState<Set<string>>(new Set(['r3']));
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <main className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Design system</h1>
          <p className={styles.lede}>
            Every token and every core component, both modes, on one page. Values are read from the
            document at runtime, so nothing here can drift from what ships.
          </p>
        </div>
        <ThemeToggle />
      </header>

      {/* ------------------------------------------------------------ type */}
      <Section
        n="01"
        title="Typography"
        note="Three faces, three jobs, no exceptions. The mono rule does most of the visual work in the product: it separates data from prose with no other cue, and aligns figures without a table."
      >
        <div className={styles.faces}>
          <div className={styles.face}>
            <span className={styles.faceRole}>Display</span>
            <span className={styles.faceSample} style={{ fontFamily: 'var(--font-display)' }}>
              PP Neue York Condensed Medium
            </span>
            <span className={styles.faceUse}>Page titles and project names in headers. Sentence case only.</span>
          </div>
          <div className={styles.face}>
            <span className={styles.faceRole}>Body</span>
            <span className={styles.faceSample} style={{ fontFamily: 'var(--font-body)' }}>
              PP Neue York Regular <em style={{ fontWeight: 500, fontStyle: 'normal' }}>and Medium</em>
            </span>
            <span className={styles.faceUse}>Body, labels, prose. Two weights, and there is no third.</span>
          </div>
          <div className={styles.face}>
            <span className={styles.faceRole}>Mono</span>
            <span className={`${styles.faceSample} mono`}>DM Mono 0123456789</span>
            <span className={styles.faceUse}>
              Every number, date, identifier, case number, count and timing.
            </span>
          </div>
        </div>

        <div className={styles.scale}>
          {TYPE_STEPS.map((s) => (
            <div key={s.token} className={styles.scaleRow}>
              <span className={`${styles.scaleLabel} mono`}>{s.label}</span>
              <span
                className={styles.scaleSample}
                style={{
                  fontSize: `var(${s.token})`,
                  fontFamily: s.face === 'display' ? 'var(--font-display)' : 'var(--font-body)',
                  fontWeight: s.face === 'body-medium' ? 'var(--weight-medium)' : 'var(--weight-regular)',
                  lineHeight: s.face === 'display' ? 'var(--leading-display)' : 'var(--leading-body)',
                  letterSpacing: s.token === '--type-display-lg' ? 'var(--track-display)' : 'var(--track-none)',
                }}
              >
                {s.sample}
              </span>
            </div>
          ))}
        </div>

        <div className={styles.monoProof}>
          <span className={styles.proofLabel}>Why mono for data</span>
          <div className={styles.proofCols}>
            <div>
              <div className={styles.proofHead}>Body face</div>
              <div className={styles.proofBad}>1,284</div>
              <div className={styles.proofBad}>317</div>
              <div className={styles.proofBad}>96,001</div>
            </div>
            <div>
              <div className={styles.proofHead}>Mono, tabular</div>
              <div className={`${styles.proofGood} mono`}>1,284</div>
              <div className={`${styles.proofGood} mono`}>317</div>
              <div className={`${styles.proofGood} mono`}>96,001</div>
            </div>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- colour */}
      <Section
        n="02"
        title="Colour"
        note="Monochrome with one accent. If two accent elements are visible in one view, one of them is wrong. This page is the one exception, and only because a catalogue has to show the accent states side by side; no product screen may do this."
      >
        <div className={styles.swatchGroup}>
          <span className={styles.groupLabel}>Paper, three surfaces</span>
          <div className={styles.swatches}>
            {PAPER.map((n) => (
              <Swatch key={n} name={n} value={t[n]} ring />
            ))}
          </div>
        </div>
        <div className={styles.swatchGroup}>
          <span className={styles.groupLabel}>Ink, and three greys below it</span>
          <div className={styles.swatches}>
            {INK.map((n) => (
              <Swatch key={n} name={n} value={t[n]} />
            ))}
          </div>
        </div>
        <div className={styles.swatchGroup}>
          <span className={styles.groupLabel}>Accent, scarce by design</span>
          <div className={styles.swatches}>
            {ACCENT.map((n) => (
              <Swatch key={n} name={n} value={t[n]} ring />
            ))}
          </div>
        </div>
        <div className={styles.swatchGroup}>
          <span className={styles.groupLabel}>Semantic, and nothing else gets colour</span>
          <div className={styles.swatches}>
            {SEMANTIC.map((n) => (
              <Swatch key={n} name={n} value={t[n]} />
            ))}
          </div>
        </div>
        <div className={styles.swatchGroup}>
          <span className={styles.groupLabel}>Lines</span>
          <div className={styles.swatches}>
            {LINES.map((n) => (
              <Swatch key={n} name={n} value={t[n]} ring />
            ))}
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------- structure */}
      <Section
        n="03"
        title="Structure"
        note="0.5px hairlines everywhere. No shadow on anything except a focus ring. Elevation comes from surface tone and border weight."
      >
        <div className={styles.structGrid}>
          <div className={styles.structCard}>
            <span className={styles.groupLabel}>Radius 0, surfaces</span>
            <div className={styles.radiusDemo}>
              <div className={styles.demoCard}>Card</div>
              <div className={styles.demoCard}>Panel</div>
              <div className={styles.demoCard}>Row</div>
            </div>
            <p className={styles.note}>Cards, panels, rows and tables. Held absolutely.</p>
          </div>
          <div className={styles.structCard}>
            <span className={styles.groupLabel}>Radius 2px, controls</span>
            <div className={styles.radiusDemo}>
              <button type="button">Button</button>
              <input defaultValue="Input" aria-label="Radius demo input" />
            </div>
            <p className={styles.note}>Inputs and buttons only. There is no third radius.</p>
          </div>
          <div className={styles.structCard}>
            <span className={styles.groupLabel}>Elevation by tone</span>
            <div className={styles.elevation}>
              <div className={styles.elevRail}>rail</div>
              <div className={styles.elevPage}>page</div>
              <div className={styles.elevCard}>card</div>
            </div>
            <p className={styles.note}>Three surfaces, no shadow between them.</p>
          </div>
        </div>
      </Section>

      {/* --------------------------------------------------------- spacing */}
      <Section n="04" title="Spacing and density" note="Seven steps. Nothing between them.">
        <div className={styles.spaceLadder}>
          {SPACE.map((n) => (
            <div key={n} className={styles.spaceRow}>
              <span className={`${styles.spaceLabel} mono`}>{t[n] || '...'}</span>
              <span className={styles.spaceBar} style={{ width: `var(${n})` }} />
              <span className={styles.spaceName}>{n.replace('--', '')}</span>
            </div>
          ))}
        </div>
        <div className={styles.densityDemo}>
          <div>
            <span className={styles.groupLabel}>List row, 36px</span>
            <div className={styles.listRow}>
              <span>Disneyland Forward, Phase 2</span>
              <span className="mono">2026-07-14</span>
            </div>
            <div className={styles.listRow}>
              <span>Bangkok Entertainment Complex</span>
              <span className="mono">2026-07-11</span>
            </div>
          </div>
          <div>
            <span className={styles.groupLabel}>Dense table row, 32px</span>
            <div className={styles.denseRow}>
              <span>SCH 2026071042</span>
              <span className="mono">18</span>
            </div>
            <div className={styles.denseRow}>
              <span>SCH 2026069117</span>
              <span className="mono">4</span>
            </div>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------ components */}
      <Section
        n="05"
        title="Components"
        note="The core set. Anything built later composes from these rather than restyling."
      >
        <div className={styles.compGrid}>
          <div className={styles.structCard}>
            <span className={styles.groupLabel}>Buttons</span>
            <div className={styles.compRow}>
              <button type="button" className={styles.primary}>
                Generate brief
              </button>
              <button type="button">Dismiss</button>
              <button type="button" disabled>
                Unavailable
              </button>
            </div>
            <p className={styles.note}>One primary per view. That is the accent budget spent.</p>
          </div>

          <div className={styles.structCard}>
            <span className={styles.groupLabel}>Chips, with faceted counts</span>
            <div className={styles.compRow}>
              {[
                ['All', '1,284'],
                ['Tenders and RFPs', '317'],
                ['Project event', '967'],
              ].map(([label, count], i) => (
                <button key={label} type="button" className={`${styles.chip} ${i === 1 ? styles.chipActive : ''}`}>
                  {label}
                  <span className={`${styles.chipCount} mono`}>{count}</span>
                </button>
              ))}
            </div>
            <p className={styles.note}>Counts are mono. Selection is a border, never a fill.</p>
          </div>

          <div className={styles.structCard}>
            <span className={styles.groupLabel}>Status</span>
            <div className={styles.compRow}>
              <span className={styles.badge}>Date unknown</span>
              <span className={`${styles.badge} ${styles.badgeOk}`}>
                <span className={styles.dot} /> Healthy
              </span>
              <span className={`${styles.badge} ${styles.badgeBad}`}>
                <span className={styles.dot} /> Silent 14d
              </span>
            </div>
            <p className={styles.note}>
              Red and green mean failure and health. Stage never gets a colour; it is carried by
              position and label.
            </p>
          </div>

          <div className={styles.structCard}>
            <span className={styles.groupLabel}>Stage, without a palette</span>
            <div className={styles.stageRow}>
              <span className={styles.stageFrom}>Filed</span>
              <span className={`${styles.stageArrow} mono`}>&rarr;</span>
              <span className={styles.stageTo}>Under review</span>
            </div>
            <p className={styles.note}>From and to in mono. The change is the event, not the colour.</p>
          </div>
        </div>

        <div className={styles.rowStates}>
          <span className={styles.groupLabel}>Row states</span>
          <div className={styles.table} role="table" aria-label="Row state specimen">
            <div className={styles.tableHead} role="row">
              <span role="columnheader" />
              <span role="columnheader">Project</span>
              <span role="columnheader">Market</span>
              <span role="columnheader">Stage</span>
              <span className={styles.numHead} role="columnheader">
                Last activity
              </span>
            </div>
            {[
              { id: 'r1', name: 'Ocean Front Walk hotel', market: 'Anaheim', stage: 'Filed', date: '2026-07-30' },
              { id: 'r2', name: 'Disneyland Forward, Phase 2', market: 'Anaheim', stage: 'Under review', date: '2026-07-28' },
              { id: 'r3', name: 'Entertainment Complex, Bang Na', market: 'Bangkok', stage: 'Scoping', date: '2026-07-22' },
              { id: 'r4', name: 'Resort corridor rezoning', market: 'Las Vegas', stage: 'Filed', date: '2026-07-19' },
            ].map((r) => (
              <div
                key={r.id}
                role="row"
                className={`${styles.tableRow} ${selected === r.id ? styles.tableRowSelected : ''}`}
                onClick={() => setSelected(r.id)}
              >
                <span role="cell" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className={styles.check}
                    checked={checked.has(r.id)}
                    onChange={() => toggle(r.id)}
                    aria-label={`Select ${r.name}`}
                  />
                </span>
                <span role="cell" className={styles.cellName}>
                  {r.name}
                </span>
                <span role="cell" className={styles.cellMeta}>
                  {r.market}
                </span>
                <span role="cell" className={styles.cellMeta}>
                  {r.stage}
                </span>
                <span role="cell" className={`${styles.cellNum} mono`}>
                  {r.date}
                </span>
              </div>
            ))}
          </div>
          <p className={styles.note}>
            Default, hover tint, selected with a 2px accent leading edge and no fill, multi-selected by
            checkbox. Never a coloured row fill.
          </p>
        </div>

        <div className={styles.compGrid}>
          <div className={styles.structCard}>
            <span className={styles.groupLabel}>Empty state, honest</span>
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Nothing moved.</p>
              <p className={styles.note}>
                Stage history began on 2026-07-24, so this will be thin for a while. That is the data,
                not a failure.
              </p>
            </div>
          </div>
          <div className={styles.structCard}>
            <span className={styles.groupLabel}>Motion</span>
            <ul className={styles.motionList}>
              <li>
                <span className="mono">120ms</span> state changes
              </li>
              <li>
                <span className="mono">180ms</span> panel transitions
              </li>
              <li>ease-out only. No bounce, no spring.</li>
              <li>No entrance animation on content.</li>
            </ul>
            <p className={styles.note}>
              The one place motion earns its keep is the optimistic update: a dismissed row fades
              rather than vanishing.
            </p>
          </div>
        </div>
      </Section>
    </main>
  );
}
