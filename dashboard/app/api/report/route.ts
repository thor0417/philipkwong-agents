// POST /api/report -> a generated document, and the delivery row that records it.
//
// THE PROVENANCE GATE RUNS HERE, before anything is rendered. A document that
// cannot state where every line came from does not get produced: the request
// fails with 422 and names the offending section. That is the mechanism behind
// the claim that these documents are trustworthy - not a prompt, not a review
// step, a refusal.
//
// THREE FORMATS FROM ONE DOCUMENT. The PDF is the document; the CSV and XLSX are
// the same content as rows, for a client who wants to sort it. All three carry
// the provenance column, because a spreadsheet that drops the labels would be a
// way to launder an assessment into a fact.
//
// EVERY GENERATION WRITES A DELIVERY ROW. If that write fails the document is
// still returned - refusing to hand over a finished report because a log write
// failed would be the wrong trade - but the response says so, and the composer
// shows it. A delivery that was not recorded is worse than one that was, and
// silence about it is worse still.

import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { renderDocumentPdf } from './doc-pdf';
import { assertProvenance, basisLine, provenanceTally, ProvenanceError, type ReportDocument } from '@/lib/report-model';
import { requireUser } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GenerateRequest {
  doc: ReportDocument;
  format: 'pdf' | 'csv' | 'xlsx';
  clientId: string | null;
  documentType: string;
  periodStart: string | null;
  periodEnd: string | null;
  scope: Record<string, unknown>;
}

function csvCell(v: string): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// THE TABULAR FORMATS CARRY THE ENTRIES TOO.
//
// A spreadsheet is what gets forwarded, sorted and pasted into a deck, so a
// section whose content moved from lines into entries must not arrive here as
// an empty band. Every entry becomes a Project row carrying its description,
// then one row per filing beneath it - which is also the shape a reader wants
// in a sheet, since the project name is then filterable.
function toRows(doc: ReportDocument): string[][] {
  const rows: string[][] = [['Section', 'Project', 'Provenance', 'Statement', 'Detail', 'Source']];
  for (const sec of doc.sections) {
    for (const l of sec.lines) rows.push([sec.title, '', l.provenance, l.text, l.meta ?? '', l.source ?? '']);
    for (const e of sec.entries ?? []) {
      if (e.summary) {
        rows.push([sec.title, e.name, 'RECORD', e.summary.text, e.meta, e.summary.url]);
      }
      if (e.assembled) {
        // No provenance column value: the assembled sentence is a caption of the
        // rows beneath it, not a fourth kind of claim. Leaving the cell empty
        // says that more honestly than borrowing one of the three labels.
        rows.push([sec.title, e.name, '', e.assembled, e.meta, '']);
      }
      for (const r of e.records) {
        const detail = [
          r.reference,
          r.figures.join(' | ') || null,
          r.players.length ? `Players: ${r.players.map((p) => `${p.name} (${p.role})`).join('; ')}` : null,
          r.contact,
        ]
          .filter(Boolean)
          .join(' | ');
        rows.push([sec.title, e.name, r.provenance, `${r.date ? `${r.date}. ` : ''}${r.text}`, detail, r.url]);
      }
    }
    for (const l of sec.commentary) rows.push([sec.title, '', l.provenance, l.text, '', '']);
  }
  return rows;
}

async function xlsx(doc: ReportDocument): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = doc.brandName;
  const ws = wb.addWorksheet('Report');
  // The scoping statement leads the sheet as well as the cover. A spreadsheet
  // gets forwarded without its PDF, and a sheet of rows with no stated scope is
  // exactly the silent omission the brief forbids.
  ws.addRow([doc.title]);
  ws.addRow([`Prepared for ${doc.addressee} by ${doc.brandName}`]);
  ws.addRow([`Geography: ${doc.scope.geography}`]);
  ws.addRow([`Period: ${doc.scope.period}${doc.scope.periodOpen ? ' (not closed)' : ''}`]);
  ws.addRow([`Filters: ${doc.scope.filters.join(' | ') || 'none'}`]);
  ws.addRow([`Basis: ${basisLine(doc.projectCount, doc.recordCount)}`]);
  ws.addRow([]);
  for (const r of toRows(doc)) ws.addRow(r);
  ws.getRow(8).font = { bold: true };
  ws.columns = [{ width: 26 }, { width: 14 }, { width: 82 }, { width: 26 }, { width: 52 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function POST(req: Request) {
  const unauthorised = await requireUser(req);
  if (unauthorised) return unauthorised;

  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body?.doc?.sections) {
    return NextResponse.json({ error: 'Missing document.' }, { status: 400 });
  }

  // THE GATE.
  try {
    assertProvenance(body.doc);
  } catch (e) {
    if (e instanceof ProvenanceError) {
      return NextResponse.json(
        { error: `Refused: ${e.message}`, kind: 'provenance' },
        { status: 422 }
      );
    }
    throw e;
  }

  const doc = body.doc;
  const tally = provenanceTally(doc);
  const stamp = (doc.generatedAt ?? new Date().toISOString()).slice(0, 10);
  // THE DOCUMENT TYPE IS PART OF THE FILENAME, not just of the row.
  //
  // Without it a full report, a county report and a referral brief generated for
  // one client on one day all land on "simtec-attractions-2026-08-06.pdf". The
  // delivery log then holds three rows that cannot be told apart by the one
  // column that names the artefact, and "exactly what this client received" -
  // the whole reason the table exists - becomes unanswerable. Found by reading
  // the rows back rather than by reading the code.
  const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const who = slug(doc.clientName ?? doc.brandName ?? 'report');
  const what = slug(body.documentType || 'report');
  const base = `${who}-${what}-${stamp}`;

  let payload: Buffer;
  let contentType: string;
  let filename: string;
  try {
    if (body.format === 'csv') {
      payload = Buffer.from(toRows(doc).map((r) => r.map(csvCell).join(',')).join('\r\n'), 'utf8');
      contentType = 'text/csv; charset=utf-8';
      filename = `${base}.csv`;
    } else if (body.format === 'xlsx') {
      payload = await xlsx(doc);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      filename = `${base}.xlsx`;
    } else {
      payload = await renderDocumentPdf(doc);
      contentType = 'application/pdf';
      filename = `${base}.pdf`;
    }
  } catch (error) {
    console.error('report render failed:', error);
    return NextResponse.json({ error: `Render failed: ${String(error)}` }, { status: 500 });
  }

  // THE DELIVERY ROW, WRITTEN AS THE CALLER, not with a service key.
  //
  // The dashboard deployment holds the anon key and nothing else, and this route
  // needs no more than that: the deliveries policy grants authenticated full
  // access, and the caller has already been verified by requireUser. Introducing
  // a service-role key here to write one row would put an RLS-bypassing secret
  // into a deployment that currently has none, to gain nothing.
  let deliveryError: string | null = null;
  const authHeader = req.headers.get('authorization') ?? '';
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { auth: { persistSession: false }, global: { headers: { Authorization: authHeader } } }
  );
  const { error: dErr } = await db.from('deliveries').insert({
    client_id: body.clientId,
    document_type: body.documentType || 'report',
    // The scope RESOLVED, not a reference to the client's stored scope: that
    // scope is editable and will change, and a record that changes with it
    // rewrites what a client was told.
    scope: { ...body.scope, statement: doc.scope, provenance: tally },
    brand_name: doc.brandName,
    addressee: doc.addressee,
    period_start: body.periodStart,
    period_end: body.periodEnd,
    project_count: doc.projectCount,
    record_count: doc.recordCount,
    file_path: filename,
    delivery_status: 'generated',
  });
  if (dErr) deliveryError = dErr.message;

  return new NextResponse(new Uint8Array(payload), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Provenance-Record': String(tally.RECORD),
      'X-Provenance-Press': String(tally.PRESS),
      'X-Provenance-Assessment': String(tally.ASSESSMENT),
      // Read by the composer, which shows it rather than assuming the log wrote.
      'X-Delivery-Logged': deliveryError ? 'false' : 'true',
      ...(deliveryError ? { 'X-Delivery-Error': deliveryError.slice(0, 200) } : {}),
    },
  });
}
