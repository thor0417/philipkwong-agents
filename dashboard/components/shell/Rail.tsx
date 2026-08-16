'use client';

// THE LEFT RAIL. 200px, collapsible to 56px, and the collapse is remembered.
//
// Two zones, always in the same order: primary navigation, which never changes,
// then contextual navigation belonging to the active screen. The boundary
// matters. A person learns the top of the rail once and stops reading it; the
// bottom is where the current screen's own structure lives (views, geography,
// saved views) and is expected to differ.
//
// The contextual zone is filled by a PORTAL rather than by prop-drilling or a
// context setter. Screens render <RailSection> wherever it suits their own code
// and it lands here. A context setter would mean a screen writing to shell state
// during render, which is a render-loop waiting to happen.

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import { NAV, activeHref } from './navigation';
import styles from './Rail.module.css';

export const RAIL_SLOT_ID = 'rail-contextual-slot';

export default function Rail({
  collapsed,
  onToggle,
  onSignOut,
  // False until the stored collapse state has been read. The rail animates on
  // width, so without this the first paint visibly slides from expanded to
  // collapsed for anyone who left it collapsed.
  animate = true,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onSignOut: () => void;
  animate?: boolean;
}) {
  const pathname = usePathname();
  const current = activeHref(pathname ?? '');
  // Folded groups, by label. Component state rather than storage: the shell is
  // one instance across every navigation, so this survives moving between
  // screens and resets on reload, which is the right lifetime for a fold.
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <nav
      className={`${styles.rail} ${collapsed ? styles.collapsed : ''} ${
        animate ? '' : styles.noAnimate
      }`}
      aria-label="Primary"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className={styles.scroll}>
        {NAV.map((section, i) => {
          // A FOLDED GROUP STILL OPENS ITSELF WHEN YOU ARE INSIDE IT. Otherwise
          // standing on /vocabulary would show no active item anywhere in the
          // rail, which reads as "you are nowhere".
          const holdsCurrent = section.items.some((item) => item.href === current);
          const folded =
            !!section.collapsible &&
            !collapsed &&
            !holdsCurrent &&
            !(open[section.label ?? ''] ?? false);
          return (
          <div key={section.label ?? `primary-${i}`} className={styles.section}>
            {section.label && !collapsed && !section.collapsible && (
              <span className={styles.sectionLabel}>{section.label}</span>
            )}
            {section.label && !collapsed && section.collapsible && (
              <button
                type="button"
                className={styles.sectionToggle}
                data-nav-group={section.label}
                aria-expanded={!folded}
                onClick={() =>
                  setOpen((prev) => ({
                    ...prev,
                    [section.label ?? '']: folded,
                  }))
                }
              >
                <span className={styles.sectionLabel}>{section.label}</span>
                <span className={styles.sectionCaret} aria-hidden="true">
                  {folded ? '▾' : '▴'}
                </span>
              </button>
            )}
            {section.label && collapsed && <span className={styles.collapsedRule} />}
            {!folded && section.items.map((item) => {
              const isActive = current === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  {/* The initial is the collapsed-state affordance. Not an icon:
                      an icon set would be a second visual language to learn and
                      to maintain, and these labels are already distinct at one
                      letter. */}
                  <span className={styles.mark} aria-hidden="true">
                    {item.label.charAt(0)}
                  </span>
                  <span className={styles.itemLabel}>{item.label}</span>
                </Link>
              );
            })}
          </div>
          );
        })}

        {/* Contextual navigation for the active screen lands here. Hidden while
            collapsed: at 56px there is no room for it, and half a filter tree is
            worse than none. */}
        {!collapsed && <div id={RAIL_SLOT_ID} className={styles.contextual} />}
      </div>

      {/* Account furniture, kept out of the top bar so the bar stays four
          things. Hidden at 56px: a theme segmented control does not survive the
          width, and the collapse toggle below always does. */}
      <div className={styles.foot}>
        {!collapsed && (
          <div className={styles.footRow}>
            <ThemeToggle />
            <button type="button" className={styles.signout} onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}

        <button
          type="button"
          className={styles.toggle}
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
          <span className={styles.toggleLabel}>Collapse</span>
        </button>
      </div>
    </nav>
  );
}
