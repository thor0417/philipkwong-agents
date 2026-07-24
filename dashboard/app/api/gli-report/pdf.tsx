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
const has = (f: string): boolean => fs.existsSync(path.join(FONTS_DIR, f));

// PP Neue York (three cuts) drives the branded type; DM Mono carries the
// [THERE ARE NO SHORTCUTS] signature and document links. Each family degrades
// independently so a missing file never breaks the render.
const PP = {
  display: 'PPNeueYork-CondensedMedium.ttf',
  emphasis: 'PPNeueYork-NormalMedium.ttf',
  text: 'PPNeueYork-NormalRegular.ttf',
};
const havePP = Object.values(PP).every(has);
if (havePP) {
  Font.register({ family: 'NY-Display', src: path.join(FONTS_DIR, PP.display) });
  Font.register({ family: 'NY-Emphasis', src: path.join(FONTS_DIR, PP.emphasis) });
  Font.register({ family: 'NY-Text', src: path.join(FONTS_DIR, PP.text) });
} else {
  console.warn('GLI report: PP Neue York fonts not found; falling back to Helvetica.');
}
const haveMono = has('DMMono-Regular.ttf') && has('DMMono-Medium.ttf');
if (haveMono) {
  Font.register({
    family: 'DM-Mono',
    fonts: [
      { src: path.join(FONTS_DIR, 'DMMono-Regular.ttf'), fontWeight: 400 },
      { src: path.join(FONTS_DIR, 'DMMono-Medium.ttf'), fontWeight: 500 },
    ],
  });
} else {
  console.warn('GLI report: DM Mono not found; falling back to Courier.');
}
const F = havePP
  ? { display: 'NY-Display', emphasis: 'NY-Emphasis', text: 'NY-Text' }
  : { display: 'Helvetica-Bold', emphasis: 'Helvetica-Bold', text: 'Helvetica' };
const MONO = haveMono ? 'DM-Mono' : 'Courier';

const s = StyleSheet.create({
  page: { paddingTop: 42, paddingBottom: 54, paddingHorizontal: 40, backgroundColor: '#ffffff' },
  wordmark: { fontFamily: F.display, fontSize: 11, letterSpacing: 1, color: INK, textTransform: 'uppercase' },
  title: { fontFamily: F.display, fontSize: 23, letterSpacing: 0.3, color: INK, textTransform: 'uppercase', marginTop: 6 },
  scope: { fontFamily: F.text, fontSize: 9, color: MUTED, marginTop: 6 },
  accentRule: { borderBottomWidth: 1.5, borderBottomColor: ACCENT, marginTop: 10, marginBottom: 14 },

  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 22, marginBottom: 6 },
  sumBlock: { flexDirection: 'column' },
  sumValue: { fontFamily: F.emphasis, fontSize: 20, color: INK },
  sumLabel: { fontFamily: F.text, fontSize: 8, letterSpacing: 0.8, color: MUTED, textTransform: 'uppercase', marginTop: 3 },
  breakCol: { flexDirection: 'column', width: 150 },
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
  // Player intelligence (applicant / presenter / representative / action sought),
  // muted so it reads as annotation under the title.
  players: { fontFamily: F.text, fontSize: 8, color: MUTED, marginTop: 3, lineHeight: 1.3 },
  playerKey: { fontFamily: F.emphasis, color: INK },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 3, alignItems: 'baseline' },
  url: { fontFamily: F.text, fontSize: 7, color: ACCENT, textDecoration: 'none' },
  // Distinct, mono-labelled primary-document link so the source file stands apart
  // from the record URL.
  docLink: { fontFamily: MONO, fontSize: 7, fontWeight: 500, color: ACCENT, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: 0.5 },

  footer: { position: 'absolute', bottom: 26, left: 40, right: 40, borderTopWidth: 0.5, borderTopColor: HAIRLINE, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' },
  footText: { fontFamily: F.text, fontSize: 7, color: MUTED },
  footMono: { fontFamily: MONO, fontSize: 7, letterSpacing: 1, color: MUTED, textTransform: 'uppercase' },
  footBracket: { color: ACCENT },
});

function countBy(rows: ReportLead[], key: (l: ReportLead) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) || 'Unclassified';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// Section bands read by source type on the government stream and by signal type
// elsewhere (mirrors the XLSX). Signal bands keep the canonical GLI order; source
// bands sort by size.
function groupLeads(leads: ReportLead[], streamKey: string): { label: string; items: ReportLead[] }[] {
  const isGov = streamKey === 'government';
  const key = (l: ReportLead) => (isGov ? l.sourceType : l.signalType) || 'Unclassified';
  const map = new Map<string, ReportLead[]>();
  for (const l of leads) {
    const b = map.get(key(l));
    if (b) b.push(l);
    else map.set(key(l), [l]);
  }
  const entries = [...map.entries()];
  if (isGov) {
    entries.sort((a, b) => b[1].length - a[1].length);
  } else {
    const rank = (sig: string): number => {
      const i = (GLI_SIGNAL_ORDER as readonly string[]).indexOf(sig);
      return i < 0 ? GLI_SIGNAL_ORDER.length : i;
    };
    entries.sort((a, b) => rank(a[0]) - rank(b[0]));
  }
  return entries.map(([label, items]) => ({ label, items }));
}

// The player intelligence line for a lead: only the fields actually present, so a
// government record reads with its applicant / presenter / action, and a bare
// listing shows nothing rather than empty labels.
function playerFields(l: ReportLead): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  if (l.applicant) out.push({ key: 'Applicant', value: l.applicant });
  if (l.presentedBy) out.push({ key: 'Presented by', value: l.presentedBy });
  if (l.representative) out.push({ key: 'Representative', value: l.representative });
  if (l.actionSought) out.push({ key: 'Action', value: l.actionSought });
  return out;
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
  const isGov = scope.streamKey === 'government';
  const groups = groupLeads(leads, scope.streamKey);
  const perCategory = countBy(leads, (l) => l.developmentCategory);
  // Second breakdown mirrors the section bands: source type on government, signal
  // type elsewhere.
  const secondaryLabel = isGov ? 'By source type' : 'By signal type';
  const perSecondary = countBy(leads, (l) => (isGov ? l.sourceType : l.signalType));
  const perVenue = countBy(leads, (l) => l.venueType).slice(0, 12);

  const market = scope.location ? scope.location : 'Global';
  const category = scope.category !== 'all' ? scope.category : 'All categories';
  const viewLabel = scope.view === 'archive' ? 'Archive' : 'Active';
  const scopeLine =
    `${scope.streamLabel}  |  ${viewLabel}  |  ${category}  |  Market: ${market}  |  ` +
    `${dateRange(leads)}  |  Generated ${scope.generatedDate}`;

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
            <Text style={s.sumLabel}>{secondaryLabel}</Text>
            {perSecondary.map(([k, v]) => (
              <View style={s.breakLine} key={k}>
                <Text style={s.breakLabel}>{k}</Text>
                <Text style={s.breakCount}>{v}</Text>
              </View>
            ))}
          </View>
          <View style={s.breakCol}>
            <Text style={s.sumLabel}>By venue type</Text>
            {perVenue.map(([k, v]) => (
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
            {g.items.map((l, i) => {
              const players = playerFields(l);
              return (
                <View key={`${g.label}-${i}`} style={s.entry} wrap={false}>
                  <Text style={s.entryTitle}>{l.title || '(untitled)'}</Text>
                  <View style={s.tagRow}>
                    <Text style={s.tagCat}>{l.developmentCategory}</Text>
                    {l.sourceType ? <Text style={s.tag}>{l.sourceType}</Text> : null}
                    {l.venueType ? <Text style={s.tag}>{l.venueType}</Text> : null}
                    {l.signalType ? <Text style={s.tag}>{l.signalType}</Text> : null}
                  </View>
                  <Text style={s.meta}>
                    {[l.location, l.date || 'DATE UNKNOWN', l.sourceDomain]
                      .filter(Boolean)
                      .join('   |   ')}
                  </Text>
                  {players.length ? (
                    <Text style={s.players}>
                      {players.map((p, j) => (
                        <Text key={p.key}>
                          {j > 0 ? '   |   ' : ''}
                          <Text style={s.playerKey}>{p.key}: </Text>
                          {p.value}
                        </Text>
                      ))}
                    </Text>
                  ) : null}
                  <View style={s.linkRow}>
                    {l.url ? (
                      <Link src={l.url} style={s.url}>
                        {l.url}
                      </Link>
                    ) : null}
                    {l.primaryDocumentUrl ? (
                      <Link src={l.primaryDocumentUrl} style={s.docLink}>
                        Primary document
                      </Link>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ))}

        {/* Footer: DM Mono signature at the foot, generation credit opposite. */}
        <View style={s.footer} fixed>
          <Text style={s.footMono}>
            <Text style={s.footBracket}>[</Text> THERE ARE NO SHORTCUTS <Text style={s.footBracket}>]</Text>
          </Text>
          <Text style={s.footText}>Philip Kwong / Grant Leisure International   {scope.generatedDate}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(payload: ReportPayload): Promise<Buffer> {
  return renderToBuffer(<ReportDocument payload={payload} />);
}
