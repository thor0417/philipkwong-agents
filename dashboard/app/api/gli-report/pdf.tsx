// Branded GLI PDF report, rendered server-side with @react-pdf/renderer (pure
// Node, no headless browser). Matches the dashboard design system: PP Neue York
// (three cuts), burnt orange #B34700 accent, sharp corners, hairline rules, no
// shadows. @react-pdf uses its own StyleSheet (not CSS Modules) because it is a
// separate renderer, not the browser DOM.

import fs from 'node:fs';
import path from 'node:path';
import {
  Document,
  Page,
  View,
  Text,
  Link,
  Font,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer';
import { GLI_SIGNAL_ORDER } from '@/lib/types';
import type { ReportPayload, ReportLead } from '@/lib/gli-report';

const INK = '#0a0a0a';
const ACCENT = '#b34700';
const MUTED = '#6b6b6b';
const HAIRLINE = '#d7d3cd';

// Register the PP Neue York TTFs from public/fonts when present; fall back to the
// built-in Helvetica if they are not bundled (so the report always renders).
const FONTS_DIR = path.join(process.cwd(), 'public', 'fonts');
const FONT_FILES = {
  display: 'PPNeueYork-CondensedMedium.ttf',
  emphasis: 'PPNeueYork-NormalMedium.ttf',
  text: 'PPNeueYork-NormalRegular.ttf',
};
const haveFonts = Object.values(FONT_FILES).every((f) => fs.existsSync(path.join(FONTS_DIR, f)));
if (haveFonts) {
  Font.register({ family: 'NY-Display', src: path.join(FONTS_DIR, FONT_FILES.display) });
  Font.register({ family: 'NY-Emphasis', src: path.join(FONTS_DIR, FONT_FILES.emphasis) });
  Font.register({ family: 'NY-Text', src: path.join(FONTS_DIR, FONT_FILES.text) });
} else {
  console.warn('GLI report: PP Neue York fonts not found; falling back to Helvetica.');
}
const F = haveFonts
  ? { display: 'NY-Display', emphasis: 'NY-Emphasis', text: 'NY-Text' }
  : { display: 'Helvetica-Bold', emphasis: 'Helvetica-Bold', text: 'Helvetica' };

const s = StyleSheet.create({
  page: { paddingTop: 42, paddingBottom: 54, paddingHorizontal: 40, backgroundColor: '#ffffff' },
  wordmark: { fontFamily: F.display, fontSize: 11, letterSpacing: 1, color: INK, textTransform: 'uppercase' },
  title: { fontFamily: F.display, fontSize: 23, letterSpacing: 0.3, color: INK, textTransform: 'uppercase', marginTop: 6 },
  scope: { fontFamily: F.text, fontSize: 9, color: MUTED, marginTop: 6 },
  accentRule: { borderBottomWidth: 1.5, borderBottomColor: ACCENT, marginTop: 10, marginBottom: 14 },

  summary: { flexDirection: 'row', gap: 28, marginBottom: 6 },
  sumBlock: { flexDirection: 'column' },
  sumValue: { fontFamily: F.emphasis, fontSize: 20, color: INK },
  sumLabel: { fontFamily: F.text, fontSize: 8, letterSpacing: 0.8, color: MUTED, textTransform: 'uppercase', marginTop: 3 },
  breakCol: { flexDirection: 'column', maxWidth: 200 },
  breakLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  breakLabel: { fontFamily: F.text, fontSize: 8, color: INK },
  breakCount: { fontFamily: F.emphasis, fontSize: 8, color: ACCENT, marginLeft: 10 },

  groupBand: { borderTopWidth: 0.5, borderTopColor: INK, paddingTop: 9, paddingBottom: 6, marginTop: 14, flexDirection: 'row', alignItems: 'baseline' },
  groupName: { fontFamily: F.display, fontSize: 12, letterSpacing: 0.3, color: INK, textTransform: 'uppercase' },
  groupCount: { fontFamily: F.emphasis, fontSize: 12, color: ACCENT, marginLeft: 8 },

  entry: { borderBottomWidth: 0.5, borderBottomColor: HAIRLINE, paddingVertical: 7 },
  entryTitle: { fontFamily: F.text, fontSize: 10, color: INK, lineHeight: 1.35 },
  tagRow: { flexDirection: 'row', marginTop: 4, gap: 6, flexWrap: 'wrap' },
  tagCat: { fontFamily: F.emphasis, fontSize: 7, letterSpacing: 0.5, color: '#ffffff', backgroundColor: ACCENT, paddingVertical: 2, paddingHorizontal: 4, textTransform: 'uppercase' },
  tag: { fontFamily: F.emphasis, fontSize: 7, letterSpacing: 0.5, color: INK, borderWidth: 0.5, borderColor: HAIRLINE, paddingVertical: 2, paddingHorizontal: 4, textTransform: 'uppercase' },
  meta: { fontFamily: F.text, fontSize: 8, color: MUTED, marginTop: 4 },
  url: { fontFamily: F.text, fontSize: 7, color: ACCENT, marginTop: 2, textDecoration: 'none' },

  footer: { position: 'absolute', bottom: 26, left: 40, right: 40, borderTopWidth: 0.5, borderTopColor: HAIRLINE, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' },
  footText: { fontFamily: F.text, fontSize: 7, color: MUTED },
});

function countBy(rows: ReportLead[], key: (l: ReportLead) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) || 'Unclassified';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// Group by signal_type (opportunity / government) or by publication month
// (intelligence, newest first).
function groupLeads(leads: ReportLead[], streamKey: string): { label: string; items: ReportLead[] }[] {
  const push = (map: Map<string, ReportLead[]>, k: string, l: ReportLead) => {
    const b = map.get(k);
    if (b) b.push(l);
    else map.set(k, [l]);
  };
  if (streamKey === 'intelligence') {
    const sorted = [...leads].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const map = new Map<string, ReportLead[]>();
    for (const l of sorted) push(map, l.date ? l.date.slice(0, 7) : 'Undated', l);
    return [...map.entries()].map(([label, items]) => ({ label, items }));
  }
  const rank = (sig: string): number => {
    const i = (GLI_SIGNAL_ORDER as readonly string[]).indexOf(sig);
    return i < 0 ? GLI_SIGNAL_ORDER.length : i;
  };
  const map = new Map<string, ReportLead[]>();
  for (const l of leads) push(map, l.signalType || 'Unclassified', l);
  return [...map.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([label, items]) => ({ label, items }));
}

function dateRange(leads: ReportLead[]): string {
  const dates = leads.map((l) => l.date).filter(Boolean).sort();
  if (dates.length === 0) return 'no dates';
  const lo = dates[0];
  const hi = dates[dates.length - 1];
  return lo === hi ? lo : `${lo} to ${hi}`;
}

function ReportDocument({ payload }: { payload: ReportPayload }) {
  const { scope, leads } = payload;
  const groups = groupLeads(leads, scope.streamKey);
  const perCategory = countBy(leads, (l) => l.developmentCategory);
  const perSignal = countBy(leads, (l) => l.signalType);

  const market = scope.location ? scope.location : 'Global';
  const category = scope.category !== 'all' ? scope.category : 'All categories';
  const scopeLine =
    `${scope.streamLabel}  |  ${category}  |  Market: ${market}  |  ` +
    `${dateRange(leads)}  |  Generated ${scope.generatedDate}` +
    (scope.includesStale ? '  |  incl. closed/older' : '');

  return (
    <Document title={`GLI ${scope.streamLabel} report`}>
      <Page size="A4" style={s.page} wrap>
        {/* Cover header */}
        <Text style={s.wordmark}>Philip Kwong  /  Grant Leisure International</Text>
        <Text style={s.title}>
          {scope.focusLabel ? scope.focusLabel : 'GLI Development Intelligence'}
        </Text>
        <Text style={s.scope}>{scopeLine}</Text>
        <View style={s.accentRule} />

        {/* Summary strip */}
        <View style={s.summary}>
          <View style={s.sumBlock}>
            <Text style={s.sumValue}>{leads.length}</Text>
            <Text style={s.sumLabel}>Total leads</Text>
          </View>
          <View style={s.breakCol}>
            <Text style={s.sumLabel}>By category</Text>
            {perCategory.map(([k, v]) => (
              <View style={s.breakLine} key={k}>
                <Text style={s.breakLabel}>{k}</Text>
                <Text style={s.breakCount}>{v}</Text>
              </View>
            ))}
          </View>
          <View style={s.breakCol}>
            <Text style={s.sumLabel}>By signal type</Text>
            {perSignal.map(([k, v]) => (
              <View style={s.breakLine} key={k}>
                <Text style={s.breakLabel}>{k}</Text>
                <Text style={s.breakCount}>{v}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Body */}
        {groups.length === 0 && <Text style={s.meta}>No leads in this filtered set.</Text>}
        {groups.map((g) => (
          <View key={`body-${g.label}`}>
            <View style={s.groupBand} wrap={false}>
              <Text style={s.groupName}>{g.label}</Text>
              <Text style={s.groupCount}>{g.items.length}</Text>
            </View>
            {g.items.map((l, i) => (
              <View key={`${g.label}-${i}`} style={s.entry} wrap={false}>
                <Text style={s.entryTitle}>{l.title || '(untitled)'}</Text>
                <View style={s.tagRow}>
                  <Text style={s.tagCat}>{l.developmentCategory}</Text>
                  {l.venueType ? <Text style={s.tag}>{l.venueType}</Text> : null}
                  {l.signalType ? <Text style={s.tag}>{l.signalType}</Text> : null}
                </View>
                <Text style={s.meta}>
                  {[l.location || '(location n/a)', l.date || 'undated', l.sourceDomain]
                    .filter(Boolean)
                    .join('   |   ')}
                </Text>
                {l.url ? (
                  <Link src={l.url} style={s.url}>
                    {l.url}
                  </Link>
                ) : null}
              </View>
            ))}
          </View>
        ))}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footText}>
            Source: GLI development-intelligence pipeline. Leads captured on legitimacy, not fit-scored.
          </Text>
          <Text style={s.footText}>Generated by Philip Kwong / GLI  {scope.generatedDate}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(payload: ReportPayload): Promise<Buffer> {
  return renderToBuffer(<ReportDocument payload={payload} />);
}
