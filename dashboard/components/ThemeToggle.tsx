'use client';

// THEME CONTROL. Three states, because two is a lie: a product that only offers
// light and dark cannot follow the operating system, and following the operating
// system is what most people actually want. 'system' is the default and defers
// to prefers-color-scheme; light and dark stamp data-theme on the root, which
// tokens.css declares as beating the media query in BOTH directions.
//
// The stored preference is read before paint by the inline script in
// app/layout.tsx, so a dark-mode user never sees a white flash. This component
// only writes; it must never be the thing that first applies the theme.

import { useEffect, useState } from 'react';
import styles from './ThemeToggle.module.css';

export type ThemeChoice = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'pk-theme';

const CHOICES: { key: ThemeChoice; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'Auto' },
];

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export default function ThemeToggle() {
  // Starts as null rather than 'system' so the control renders nothing until the
  // stored value is known. Rendering a guess would light the wrong segment for
  // one frame on every load.
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    setChoice(stored === 'light' || stored === 'dark' ? stored : 'system');
  }, []);

  function pick(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
    if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, next);
  }

  return (
    <div className={styles.group} role="group" aria-label="Colour theme">
      {CHOICES.map((c) => (
        <button
          key={c.key}
          type="button"
          className={`${styles.seg} ${choice === c.key ? styles.segActive : ''}`}
          aria-pressed={choice === c.key}
          onClick={() => pick(c.key)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
