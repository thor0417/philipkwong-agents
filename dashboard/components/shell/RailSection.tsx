'use client';

// A screen's contextual navigation, rendered into the rail from wherever the
// screen's own code is clearest. See Rail.tsx for why this is a portal.
//
// Renders nothing until mounted and nothing when the rail is collapsed (the
// slot element does not exist then), so a screen never has to know the rail's
// state to use it.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RAIL_SLOT_ID } from './Rail';
import styles from './Rail.module.css';

export default function RailSection({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // Re-checked on every render pass via state set in an effect, so a screen
  // mounted before the rail (or across a collapse toggle) still finds the slot.
  useEffect(() => {
    setSlot(document.getElementById(RAIL_SLOT_ID));
  });

  if (!slot) return null;

  return createPortal(
    <div className={styles.section}>
      {title && <span className={styles.sectionLabel}>{title}</span>}
      {children}
    </div>,
    slot
  );
}
