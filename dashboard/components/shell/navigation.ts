// THE NAVIGATION, DECLARED ONCE.
//
// The rail and the command palette are the same navigation in two forms, so
// they read the same list. A screen added here appears in both, and cannot
// appear in one and not the other.
//
// Nothing unbuilt is listed. A greyed-out row for a screen that does not exist
// is a promise the product has not kept, and it costs a click to discover that.

export interface NavItem {
  label: string;
  href: string;
  /** Keywords the command palette matches on beyond the label. */
  keywords?: string[];
  /** Shown in the palette to say what the screen is for. */
  hint?: string;
}

export interface NavSection {
  /** Null for the primary group, which needs no heading. */
  label: string | null;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    label: null,
    items: [
      {
        label: 'Today',
        href: '/today',
        keywords: ['home', 'moved', 'new', 'digest', 'landing'],
        hint: 'What happened while you were away.',
      },
      {
        label: 'Register',
        href: '/register',
        keywords: ['leads', 'records', 'triage', 'opportunities', 'gli'],
        hint: 'The working surface. Triage, filter, brief.',
      },
      {
        label: 'Projects',
        href: '/projects',
        keywords: ['clusters', 'developments'],
        hint: 'Projects and their record histories.',
      },
    ],
  },
  {
    label: 'Reference',
    items: [
      {
        label: 'Design system',
        href: '/design',
        keywords: ['tokens', 'colour', 'type', 'components'],
        hint: 'Every token and component, both modes.',
      },
      {
        label: 'Legacy pipeline',
        href: '/pipeline',
        keywords: ['fuel', 'consulting', 'archive'],
        // Its lanes were retired on 2026-07-29; the rows are frozen but intact.
        hint: 'Retired lanes. Frozen, kept for reference.',
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV.flatMap((s) => s.items);

/** The nav entry a path belongs to, longest match first so /project/x resolves. */
export function activeHref(pathname: string): string | null {
  const matches = NAV_ITEMS.map((i) => i.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length);
  return matches[0] ?? null;
}
