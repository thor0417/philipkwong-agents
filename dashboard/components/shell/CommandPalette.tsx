'use client';

// THE COMMAND PALETTE.
//
// Built now rather than as a garnish, because at the scale this product is
// heading for it becomes the primary navigation. A rail with a dozen entries is
// browsable; fourteen hundred projects are not, and the only way to reach one by
// name is to type it.
//
// Four kinds of result, in the order they are useful:
//   1. Projects, matched server-side by name. The reason to open this.
//   2. Records, matched on title and url. See below.
//   3. Screens, so navigation never requires the mouse.
//   4. Pipelines, so switching context is one action rather than a hunt.
//
// RECORDS ARE HERE BECAUSE RECORDS IS NO LONGER A DESTINATION. Raw records are
// what a project is made of, not a place to visit: they are read as a project's
// timeline. What a browsable record table was genuinely good for is finding ONE
// document somebody has quoted at you - a case reference, a headline, a link
// pasted into an email - and that is search rather than browse. This is the
// search.
//
// cmdk is headless: it ships the list, the filtering and the roving focus, and
// exactly no styling. Everything visible here is this project's own tokens.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { useProjectSearch, useRecordSearch } from '@/lib/use-projects';
import { recordProvenance } from '@/lib/report-model';
import { useActivePipeline } from '@/lib/use-pipeline';
import { NAV_ITEMS } from './navigation';
import styles from './CommandPalette.module.css';

export default function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const { pipeline, options, setPipeline } = useActivePipeline();

  // Server-side project search. The hook itself decides when the term is long
  // enough to be worth a round trip.
  const projectQuery = useProjectSearch(term);
  const projects = projectQuery.data ?? [];
  const recordQuery = useRecordSearch(term);
  const records = recordQuery.data ?? [];

  // Screens and pipelines are a short static list, so they filter here rather
  // than costing a request. cmdk's own filter is off (shouldFilter={false})
  // because it cannot rank server results it did not fetch.
  const needle = term.trim().toLowerCase();
  const screens = useMemo(
    () =>
      NAV_ITEMS.filter(
        (i) =>
          !needle ||
          i.label.toLowerCase().includes(needle) ||
          (i.keywords ?? []).some((k) => k.includes(needle))
      ),
    [needle]
  );
  const pipelines = useMemo(
    () =>
      options.filter(
        (p) =>
          !needle ||
          p.name.toLowerCase().includes(needle) ||
          p.short_name.toLowerCase().includes(needle)
      ),
    [options, needle]
  );

  // Clearing on close rather than on open: the list should not visibly reset
  // under the fade-out.
  useEffect(() => {
    if (!open) setTerm('');
  }, [open]);

  const run = useCallback(
    (action: () => void) => {
      action();
      onOpenChange(false);
    },
    [onOpenChange]
  );

  const empty =
    screens.length === 0 &&
    pipelines.length === 0 &&
    projects.length === 0 &&
    records.length === 0 &&
    !projectQuery.isFetching &&
    !recordQuery.isFetching;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      shouldFilter={false}
      loop
      overlayClassName={styles.overlay}
      contentClassName={styles.content}
    >
      <div className={styles.inputRow}>
        <Command.Input
          className={styles.input}
          value={term}
          onValueChange={setTerm}
          placeholder="Jump to a project, find a record, or go to a screen"
        />
        <kbd className={styles.kbd}>esc</kbd>
      </div>

      <Command.List className={styles.list}>
        {empty && <Command.Empty className={styles.empty}>Nothing matches that.</Command.Empty>}

        {projects.length > 0 && (
          <Command.Group heading="Projects" className={styles.group}>
            {projects.map((p) => (
              <Command.Item
                key={p.id}
                value={`project-${p.id}`}
                className={styles.item}
                onSelect={() => run(() => router.push(`/projects?selected=${p.id}`))}
              >
                <span className={styles.itemLabel}>{p.name}</span>
                <span className={styles.itemMeta}>{p.market ?? p.country ?? ''}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {/* Only worth saying while a search is genuinely outstanding. */}
        {projectQuery.isFetching && projects.length === 0 && needle.length > 1 && (
          <div className={styles.searching}>Searching projects...</div>
        )}

        {/* THE RECORD, AND WHAT OPENING IT MEANS.
            An attached record opens its PROJECT, because that is where the
            record is read - in the timeline, in the order things happened, next
            to everything else about the same site. An unattached record has no
            timeline to open, so it opens the document itself and says it is
            unattached; the Inbox is where those are worked. */}
        {records.length > 0 && (
          <Command.Group heading="Records" className={styles.group}>
            {records.map((r) => (
              <Command.Item
                key={r.id}
                value={`record-${r.id}`}
                className={styles.item}
                onSelect={() =>
                  run(() =>
                    r.project_id
                      ? router.push(`/projects?selected=${r.project_id}`)
                      : window.open(r.url, '_blank', 'noreferrer')
                  )
                }
              >
                <span className={styles.itemLabel}>{r.title ?? r.url}</span>
                <span className={styles.itemMeta}>
                  [{recordProvenance(r.source, r.source_type, r.stream)}]
                  {r.market ? ` ${r.market}` : ''}
                  {r.published_date ? ` ${r.published_date.slice(0, 10)}` : ''}
                  {r.project_id ? '' : ' - not attached'}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {recordQuery.isFetching && records.length === 0 && needle.length > 2 && (
          <div className={styles.searching}>Searching records...</div>
        )}

        {screens.length > 0 && (
          <Command.Group heading="Go to" className={styles.group}>
            {screens.map((s) => (
              <Command.Item
                key={s.href}
                value={`screen-${s.href}`}
                className={styles.item}
                onSelect={() => run(() => router.push(s.href))}
              >
                <span className={styles.itemLabel}>{s.label}</span>
                <span className={styles.itemMeta}>{s.hint}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {pipelines.length > 1 && (
          <Command.Group heading="Pipeline" className={styles.group}>
            {pipelines.map((p) => (
              <Command.Item
                key={p.id}
                value={`pipeline-${p.id}`}
                className={styles.item}
                onSelect={() => run(() => setPipeline(p.id))}
              >
                <span className={styles.itemLabel}>{p.name}</span>
                <span className={styles.itemMeta}>
                  {p.id === pipeline.id ? 'Current' : 'Switch'}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
