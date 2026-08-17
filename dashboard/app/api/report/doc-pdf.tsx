// THE SECTIONED DOCUMENT, RENDERED.
//
// Reuses the type, colour and layout vocabulary of the existing GLI renderer
// (app/api/gli-report/pdf.tsx) rather than inventing a second document design.
// That one renders a flat list of records; this one renders composed sections
// with commentary, which is a different document, not a different look.
//
// THE PROVENANCE TAG IS RENDERED AS A TAG, in the margin, in monospace, on every
// single line. Not as a footnote, not as a colour, not once per section. A
// reader scanning the page has to be able to see which statements are documented
// and which are Philip's read without reading the sentences first, and
// commentary is set apart as a block so an assessment can never be mistaken for
// the record above it.

import React from 'react';
import { Document, Page, Text, View, StyleSheet, Link, renderToBuffer } from '@react-pdf/renderer';
import { basisLine, type Entry, type ReportDocument, type Line } from '@/lib/report-model';

const INK = '#1a1a1a';
const MUTED = '#6b6b6b';
const RULE = '#d9d5cf';
const ACCENT = '#b34700';

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 48, fontSize: 9, color: INK, fontFamily: 'Helvetica' },
  brand: { fontSize: 8, letterSpacing: 1.2, color: MUTED, textTransform: 'uppercase' },
  title: { fontSize: 20, marginTop: 6, marginBottom: 2 },
  addressee: { fontSize: 10, color: MUTED, marginBottom: 14 },

  scopeBox: { borderWidth: 0.5, borderColor: RULE, padding: 10, marginBottom: 16 },
  scopeRow: { flexDirection: 'row', marginBottom: 3 },
  scopeKey: { width: 78, fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  scopeVal: { fontSize: 9, flex: 1 },
  openWarn: { fontSize: 8, color: ACCENT, marginTop: 4 },

  key: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  keyItem: { fontSize: 7.5, color: MUTED },
  keyProse: { fontSize: 7.5, color: MUTED, lineHeight: 1.45 },

  sectionTitle: { fontSize: 12, marginTop: 16, marginBottom: 2, borderBottomWidth: 0.5, borderBottomColor: RULE, paddingBottom: 3 },
  lede: { fontSize: 8, color: MUTED, marginBottom: 6 },

  line: { flexDirection: 'row', marginBottom: 5 },
  tag: { width: 62, fontSize: 6.5, letterSpacing: 0.5, color: MUTED, paddingTop: 1.5 },
  tagAssessment: { color: ACCENT },
  body: { flex: 1 },
  text: { fontSize: 9, lineHeight: 1.35 },
  meta: { fontSize: 7.5, color: MUTED, marginTop: 1 },
  link: { fontSize: 7.5, color: ACCENT, textDecoration: 'none' },

  commentary: { borderLeftWidth: 2, borderLeftColor: ACCENT, paddingLeft: 8, marginTop: 8, marginBottom: 4 },
  commentaryHead: { fontSize: 7, letterSpacing: 0.8, color: ACCENT, textTransform: 'uppercase', marginBottom: 3 },

  // THE GEOGRAPHY SUBHEADING, INSIDE A CATEGORY SECTION. Smaller than a section
  // title and larger than an entry name, because that is exactly where it sits
  // in the hierarchy: the reader is inside "Hospitality/Tourism" and this says
  // which market the next few entries are in.
  group: {
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: MUTED,
    marginTop: 12,
    marginBottom: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
    paddingBottom: 2,
  },

  // ---- THE ENTRY. A project named, described, then evidenced.
  entry: { marginTop: 10, marginBottom: 6 },
  entryHead: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 2 },
  entryName: { fontSize: 10.5, flex: 1 },
  entryMeta: { fontSize: 7.5, color: MUTED },
  entryDesc: { fontSize: 9, lineHeight: 1.4, marginBottom: 1 },
  entryCite: { fontSize: 7, color: ACCENT, textDecoration: 'none', marginBottom: 3 },
  // The assembled sentence. Set in the body face, not italicised or coloured:
  // it is a statement about the filings below it, not an aside about them.
  entryAssembled: { fontSize: 9, lineHeight: 1.4, marginBottom: 5 },

  // A DERIVED SENTENCE AT SECTION LEVEL. Same face as the assembled sentence
  // inside an entry, because it is the same kind of statement: a fact about the
  // record set, printed unlabelled because it is neither a filing nor a
  // judgement. See report-model/DERIVED_OPENERS.
  derived: { fontSize: 9, lineHeight: 1.45, marginTop: 4, marginBottom: 4 },

  // A HEADING INSIDE A SECTION: "Record provenance (our captured filings)".
  subTitle: { fontSize: 9, marginTop: 10, marginBottom: 4 },

  // THE PEOPLE BLOCK. Set between the description and the filings, because that
  // is the order the question is asked in: what is this, who is behind it, what
  // have they filed.
  people: { marginTop: 2, marginBottom: 6, paddingLeft: 8 },
  peopleHead: { fontSize: 7, letterSpacing: 0.8, color: MUTED, textTransform: 'uppercase', marginBottom: 3 },
  party: { flexDirection: 'row', marginBottom: 3 },
  partyTag: { width: 46, fontSize: 6.5, letterSpacing: 0.5, color: MUTED, paddingTop: 1.5 },
  partyBody: { flex: 1 },
  partyName: { fontSize: 8.5 },
  partyDetail: { fontSize: 7.5, color: MUTED },
  peopleNone: { fontSize: 8, color: MUTED, fontStyle: 'italic', marginBottom: 6, paddingLeft: 8 },

  rec: { flexDirection: 'row', marginBottom: 4, paddingLeft: 8 },
  recTag: { width: 46, fontSize: 6.5, letterSpacing: 0.5, color: MUTED, paddingTop: 1.5 },
  recBody: { flex: 1 },
  recDate: { fontSize: 8.5 },
  recText: { fontSize: 8.5, lineHeight: 1.35 },
  recDetail: { fontSize: 7.5, color: MUTED, marginTop: 1 },
  recContact: { fontSize: 7.5, color: MUTED, marginTop: 1 },

  empty: { fontSize: 8.5, color: MUTED, fontStyle: 'italic', marginBottom: 4 },
  footer: { position: 'absolute', bottom: 28, left: 48, right: 48, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 6 },
  footText: { fontSize: 7, color: MUTED },
});

function LineRow({ l }: { l: Line }) {
  return (
    <View style={s.line} wrap={false}>
      <Text style={[s.tag, l.provenance === 'ASSESSMENT' ? s.tagAssessment : {}]}>[{l.provenance}]</Text>
      <View style={s.body}>
        <Text style={s.text}>{l.text}</Text>
        {l.meta ? <Text style={s.meta}>{l.meta}</Text> : null}
        {l.source ? (
          <Link src={l.source} style={s.link}>
            {l.sourceLabel ?? l.source}
          </Link>
        ) : null}
      </View>
    </View>
  );
}

// THE ENTRY, RENDERED.
//
// Reading order is the order a person asks the questions in: what is this, what
// do our records show about it, and then each filing - when, what it sought, who
// the parties are, and the link to go and read it.
//
// The description paragraph is two sentences with different standing, so they
// are not run together. The first is a quotation and carries the filing's link
// directly beneath it. The second is assembled from the filings listed below and
// says so in its own first two words.
function EntryBlock({ e }: { e: Entry }) {
  return (
    <View style={s.entry} wrap={false}>
      <View style={s.entryHead}>
        <Text style={s.entryName}>{e.name}</Text>
        {e.meta ? <Text style={s.entryMeta}>{e.meta}</Text> : null}
      </View>

      {e.summary ? (
        <>
          <Text style={s.entryDesc}>{e.summary.text}</Text>
          <Link src={e.summary.url} style={s.entryCite}>
            quoted from the filing
          </Link>
        </>
      ) : null}
      {e.assembled ? <Text style={s.entryAssembled}>{e.assembled}</Text> : null}

      {/*
        SCALE, ABOVE THE PEOPLE AND ABOVE THE FILINGS. How big the thing is, once,
        instead of on a record line six filings down. The block reuses the people
        styles deliberately: it is the same shape - a tag, a claim, the link that
        carries it - and giving it its own type scale would put two visual
        languages inside one entry for no reason a reader benefits from.
      */}
      {/* The filings' own figures, above the press ones. Same styles: it is the
          same shape - a tag, a claim, the link that carries it. */}
      {e.stated.length > 0 && (
        <View style={s.people}>
          <Text style={s.peopleHead}>What the filings state</Text>
          {e.stated.map((f, i) => (
            <View key={i} style={s.party} wrap={false}>
              <Text style={s.partyTag}>[{f.provenance}]</Text>
              <View style={s.partyBody}>
                <Text style={s.partyName}>
                  {f.label}: {f.display}
                </Text>
                <Text style={s.partyDetail}>&ldquo;{f.sentence}&rdquo;</Text>
                <Link src={f.url} style={s.link}>
                  {f.sourceLabel}
                </Link>
              </View>
            </View>
          ))}
          {e.statedHeld > 0 ? (
            <Text style={s.partyDetail}>
              {e.statedHeld} further stated figure{e.statedHeld === 1 ? '' : 's'} held back to keep
              this block readable.
            </Text>
          ) : null}
        </View>
      )}

      {e.scale.length > 0 && (
        <View style={s.people}>
          <Text style={s.peopleHead}>Scale, as reported in the press</Text>
          {e.scale.map((f, i) => (
            <View key={i} style={s.party} wrap={false}>
              <Text style={s.partyTag}>[{f.provenance}]</Text>
              <View style={s.partyBody}>
                <Text style={s.partyName}>
                  {f.label}: {f.display}
                </Text>
                {/* What the publication actually said. The label cannot say what
                    an amount was for; this can. */}
                <Text style={s.partyDetail}>&ldquo;{f.sentence}&rdquo;</Text>
                <Link src={f.url} style={s.link}>
                  {f.sourceLabel}
                </Link>
              </View>
            </View>
          ))}
          {e.scaleHeld > 0 ? (
            <Text style={s.partyDetail}>
              {e.scaleHeld} further reported figure{e.scaleHeld === 1 ? '' : 's'} held back to keep
              this block readable.
            </Text>
          ) : null}
        </View>
      )}

      {e.people.length > 0 && (
        <View style={s.people}>
          <Text style={s.peopleHead}>The people</Text>
          {e.people.map((party, i) => (
            <View key={i} style={s.party} wrap={false}>
              <Text style={s.partyTag}>[{party.provenance}]</Text>
              <View style={s.partyBody}>
                <Text style={s.partyName}>
                  {party.name}
                  {party.firm ? `, ${party.firm}` : ''}
                  {` (${party.roles.join('; ')})`}
                </Text>
                {party.address ? <Text style={s.partyDetail}>{party.address}</Text> : null}
                <Text style={s.partyDetail}>
                  {party.contact
                    ? [party.contact.email, party.contact.phone].filter(Boolean).join(', ')
                    : 'No phone or email in the record.'}
                </Text>
                {party.alsoOn ? <Text style={s.partyDetail}>{party.alsoOn}</Text> : null}
                <Link src={party.sourceUrl} style={s.link}>
                  {party.sourceLabel}
                </Link>
              </View>
            </View>
          ))}
        </View>
      )}
      {e.noPeopleNote ? <Text style={s.peopleNone}>{e.noPeopleNote}</Text> : null}

      {e.records.map((r, i) => (
        <View key={i} style={s.rec} wrap={false}>
          <Text style={s.recTag}>[{r.provenance}]</Text>
          <View style={s.recBody}>
            <Text style={s.recText}>
              {r.date ? <Text style={s.recDate}>{r.date}. </Text> : null}
              {r.reference ? <Text style={s.recDate}>{r.reference}: </Text> : null}
              {r.text}
            </Text>
            {r.figures.length > 0 ? <Text style={s.recDetail}>{r.figures.join(' | ')}</Text> : null}
            {r.language ? <Text style={s.recDetail}>{r.language}</Text> : null}
            {r.players.length > 0 ? (
              <Text style={s.recDetail}>
                Players: {r.players.map((p) => `${p.name} (${p.role})`).join('; ')}
              </Text>
            ) : null}
            {r.contact ? <Text style={s.recContact}>{r.contact}</Text> : null}
            <Link src={r.url} style={s.link}>
              {r.sourceLabel}
            </Link>
          </View>
        </View>
      ))}
    </View>
  );
}

function DocBody({ doc }: { doc: ReportDocument }) {
  return (
    <Document title={doc.title}>
      <Page size="A4" style={s.page} wrap>
        <Text style={s.brand}>{doc.brandName}</Text>
        <Text style={s.title}>{doc.title}</Text>
        <Text style={s.addressee}>Prepared for {doc.addressee}</Text>

        {/* THE SCOPING STATEMENT, ON THE COVER, ALWAYS. A report scoped to
            Nevada says so on its face; it never silently omits. */}
        <View style={s.scopeBox}>
          <View style={s.scopeRow}>
            <Text style={s.scopeKey}>Geography</Text>
            <Text style={s.scopeVal}>{doc.scope.geography}</Text>
          </View>
          <View style={s.scopeRow}>
            <Text style={s.scopeKey}>Period</Text>
            <Text style={s.scopeVal}>{doc.scope.period}</Text>
          </View>
          <View style={s.scopeRow}>
            <Text style={s.scopeKey}>Pipeline</Text>
            <Text style={s.scopeVal}>{doc.scope.pipeline}</Text>
          </View>
          <View style={s.scopeRow}>
            <Text style={s.scopeKey}>Filters</Text>
            <Text style={s.scopeVal}>{doc.scope.filters.length ? doc.scope.filters.join(' | ') : 'none'}</Text>
          </View>
          <View style={s.scopeRow}>
            <Text style={s.scopeKey}>Basis</Text>
            <Text style={s.scopeVal}>{basisLine(doc.projectCount, doc.recordCount)}</Text>
          </View>
          {doc.scope.periodOpen && (
            <Text style={s.openWarn}>
              This period has not closed. Regenerating this report later will cover more than it does now.
            </Text>
          )}
        </View>

        {/* THE PROVENANCE LEGEND, IN PROSE. Three bullets read as a key to a
            chart; the July brief states it as a sentence, and a sentence is
            what a client actually reads before the first section. Same three
            labels, same meanings, and it now says WHY they are separated. */}
        <View style={s.key}>
          <Text style={s.keyProse}>
            Provenance legend. This report separates three kinds of statement so the reader can
            weigh each. [RECORD] marks facts drawn from the government filings we captured, each
            with the link to the filing itself. [PRESS] marks facts reported in the press or
            otherwise beyond our filing record. [ASSESSMENT] marks our own read, offered as
            judgment rather than as fact.
          </Text>
        </View>

        {doc.sections.map((sec) => (
          <View key={sec.id}>
            <Text style={s.sectionTitle}>{sec.title}</Text>
            {sec.lede ? <Text style={s.lede}>{sec.lede}</Text> : null}
            {sec.lines.map((l, i) => (
              <LineRow key={i} l={l} />
            ))}
            {(sec.derived ?? []).map((d, i) => (
              <Text key={`d${i}`} style={s.derived}>
                {d}
              </Text>
            ))}
            {(sec.subsections ?? []).map((sub, i) => (
              <View key={`s${i}`}>
                <Text style={s.subTitle}>{sub.title}</Text>
                {sub.lines.map((l, j) => (
                  <LineRow key={j} l={l} />
                ))}
                {sub.emptyNote ? <Text style={s.empty}>{sub.emptyNote}</Text> : null}
              </View>
            ))}
            {/* GEOGRAPHY AS A SUBHEADING, PRINTED ONLY WHEN IT CHANGES. The
                entries arrive already ordered by market, so a heading per
                change is a heading per market: one market, one subheading. */}
            {(sec.entries ?? []).map((e, i, all) => (
              <View key={e.id}>
                {e.group && e.group !== all[i - 1]?.group ? (
                  <Text style={s.group}>{e.group}</Text>
                ) : null}
                <EntryBlock e={e} />
              </View>
            ))}
            {sec.emptyNote ? <Text style={s.empty}>{sec.emptyNote}</Text> : null}
            {sec.commentary.length > 0 && (
              <View style={s.commentary}>
                <Text style={s.commentaryHead}>Assessment</Text>
                {sec.commentary.map((l, i) => (
                  <LineRow key={i} l={l} />
                ))}
              </View>
            )}
          </View>
        ))}

        <View style={s.footer} fixed>
          <Text style={s.footText}>
            {doc.brandName} | {doc.scope.geography} | {doc.scope.period}
          </Text>
          <Text style={s.footText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderDocumentPdf(doc: ReportDocument): Promise<Buffer> {
  return renderToBuffer(<DocBody doc={doc} />);
}
