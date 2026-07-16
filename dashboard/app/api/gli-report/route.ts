// POST /api/gli-report -> branded GLI PDF from the posted (visible, filtered)
// leads. Runs in the Node runtime (@react-pdf and font fs reads need Node). The
// route only formats what the client sends, so the report matches the view.

import { NextResponse } from 'next/server';
import { renderReportPdf } from './pdf';
import type { ReportPayload } from '@/lib/gli-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let payload: ReportPayload;
  try {
    payload = (await req.json()) as ReportPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!payload?.scope || !Array.isArray(payload.leads)) {
    return NextResponse.json({ error: 'Missing scope or leads.' }, { status: 400 });
  }

  try {
    const pdf = await renderReportPdf(payload);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="gli-report.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('GLI report render failed:', error);
    return NextResponse.json({ error: 'Report generation failed.' }, { status: 500 });
  }
}
