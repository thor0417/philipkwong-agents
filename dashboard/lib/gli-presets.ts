// Report focus presets: saved filter combinations so a client-focused report is
// one click. Config-driven and light -- add a preset by adding one entry. A
// preset optionally sets the stream, development category, venue, and location;
// focusLabel becomes the PDF cover title so the report is branded to the focus.

export interface GLIPreset {
  key: string;
  label: string;
  focusLabel?: string; // PDF cover title when active
  stream?: string; // opportunity | intelligence | government
  category?: string; // a development category
  venue?: string; // a venue_type
  location?: string; // free-text location filter
}

export const GLI_PRESETS: GLIPreset[] = [
  { key: 'all', label: 'All (no focus)' },
  {
    key: 'simtec',
    label: 'Simtec (Leisure/Attractions)',
    focusLabel: 'Simtec (Leisure/Attractions)',
    category: 'Leisure/Attractions',
  },
  {
    key: 'panorama',
    label: 'Panorama (Mexico/Caribbean)',
    focusLabel: 'Panorama (Mexico/Caribbean)',
    location: 'Mexico',
  },
  {
    key: 'urban',
    label: 'Smart City / Urban',
    focusLabel: 'Smart City / Urban Development',
    category: 'Smart City/Urban',
  },
  {
    key: 'hospitality',
    label: 'Hospitality / Tourism',
    focusLabel: 'Hospitality / Tourism Development',
    category: 'Hospitality/Tourism',
  },
];
