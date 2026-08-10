// GIVE EVERY PROJECT A LINE SAYING WHAT IT IS.
//
//   npm run summaries          dry run: derive, report, write nothing
//   APPLY=1 npm run summaries  write the derived pass
//   GENERATE=1 APPLY=1 ...     also write the model fallback
//
// TWO PASSES, AND THE ORDER MATTERS.
//
//   DERIVED. Quoted from the records' own words - a ZAP project brief, a CEQR
//   project description, the "relative to:" clause of a City Record notice. Free,
//   reproducible, and incapable of inventing anything. This pass runs by default.
//
//   GENERATED. A model reads the record text and writes one factual line, for
//   projects whose own words are a case number and a date. Costs a call per
//   project, so it is opt-in and only ever runs on what the first pass could not
//   answer.
//
// THE FALLBACK IS NOT AUTOMATIC AND NOT UNIVERSAL. A project whose only record
// is a meeting agenda has nothing honest to say about what it is, and the model
// is instructed to reply UNKNOWN rather than fill the space. Those stay null.
// Null renders as the name alone, which is exactly what the register showed
// before this existed, so the floor is "no worse".
//
// NEVER OVERWRITES A MANUAL SUMMARY. summary_source='manual' means Philip wrote
// the sentence, and it is skipped by both passes and by the clusterer.

import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import {
  deriveSummary,
  validateGenerated,
  SUMMARY_PROMPT,
  type SummaryRecord,
} from '../project-summary';

const APPLY = process.env.APPLY === '1';
const GENERATE = process.env.GENERATE === '1';
// Haiku is the right tier here and the gate judge's reasons do not apply: this
// is extraction from text that is in front of it, not a two-limb judgement.
const MODEL = process.env.SUMMARY_MODEL ?? 'claude-haiku-4-5';
const CONCURRENCY = 5;
const EXAMPLES = Number(process.env.EXAMPLES ?? 20);

interface ProjectRow {
  id: string;
  name: string;
  market: string | null;
  summary: string | null;
  summary_source: string | null;
  manual_overrides: Record<string, unknown> | null;
}

async function page<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function generate(client: Anthropic, name: string, recs: SummaryRecord[]): Promise<string | null> {
  // Newest first and capped: the model needs the substance of the project, not
  // every procedural notice ever filed against it, and a 40-record project would
  // otherwise send more text than the answer is worth.
  const text = [...recs]
    .sort((a, b) => String(b.published_date ?? '').localeCompare(String(a.published_date ?? '')))
    .slice(0, 4)
    .map((r) => `${r.title ?? ''}\n${(r.raw_content ?? '').slice(0, 1200)}`)
    .join('\n---\n');
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: `${SUMMARY_PROMPT}Project name: ${name}\n\n${text}` }],
    });
    const out = res.content.find((c) => c.type === 'text');
    return out && out.type === 'text' ? validateGenerated(out.text) : null;
  } catch (e) {
    console.log(`  generate failed for ${name}: ${String(e).slice(0, 100)}`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log(APPLY ? 'SUMMARIES: APPLYING' : 'SUMMARIES: DRY RUN (APPLY=1 to write)');
  console.log(GENERATE ? `model fallback: ON (${MODEL})` : 'model fallback: off (GENERATE=1 to enable)');

  const projects = await page<ProjectRow>((f, t) =>
    supabaseAdmin
      .from('projects')
      .select('id,name,market,summary,summary_source,manual_overrides')
      .range(f, t)
  );
  const leads = await page<SummaryRecord & { project_id: string | null }>((f, t) =>
    supabaseAdmin
      .from('leads')
      .select('project_id,url,title,raw_content,source,published_date')
      .not('project_id', 'is', null)
      .neq('status', 'dismissed')
      .range(f, t)
  );

  const byProject = new Map<string, SummaryRecord[]>();
  for (const l of leads) {
    if (!l.project_id) continue;
    byProject.set(l.project_id, [...(byProject.get(l.project_id) ?? []), l]);
  }
  console.log(`projects: ${projects.length}   records attached: ${leads.length}\n`);

  const samples: { name: string; market: string; summary: string; src: string }[] = [];
  const byField = new Map<string, number>();
  let derived = 0;
  let generated = 0;
  let stillNull = 0;
  let manual = 0;
  const needModel: ProjectRow[] = [];

  for (const p of projects) {
    if (p.summary_source === 'manual') {
      manual++;
      continue;
    }
    const recs = byProject.get(p.id) ?? [];
    const d = deriveSummary(recs);
    if (!d) {
      needModel.push(p);
      continue;
    }
    derived++;
    byField.set(d.field ?? '?', (byField.get(d.field ?? '?') ?? 0) + 1);
    if (samples.length < EXAMPLES)
      samples.push({ name: p.name, market: p.market ?? '', summary: d.summary, src: `derived/${d.field}` });
    if (APPLY) {
      const { error } = await supabaseAdmin
        .from('projects')
        .update({ summary: d.summary, summary_source: 'derived', summary_url: d.sourceUrl })
        .eq('id', p.id);
      if (error) throw new Error(`derive write failed for ${p.name}: ${error.message}`);
    }
  }

  console.log(`DERIVED:  ${derived} of ${projects.length}  (${Math.round((derived / projects.length) * 100)}%)`);
  console.log(`no source sentence: ${needModel.length}   manual, untouched: ${manual}`);
  console.log('  by field: ' + [...byField].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));

  if (GENERATE) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    let i = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (i < needModel.length) {
          const p = needModel[i++];
          const recs = byProject.get(p.id) ?? [];
          if (recs.length === 0) {
            stillNull++;
            continue;
          }
          const line = await generate(client, p.name, recs);
          if (!line) {
            stillNull++;
            continue;
          }
          generated++;
          if (samples.length < EXAMPLES + 10)
            samples.push({ name: p.name, market: p.market ?? '', summary: line, src: 'generated' });
          if (APPLY) {
            const { error } = await supabaseAdmin
              .from('projects')
              // NO summary_url. A generated line is the model's reading of
              // several records, so there is no single filing it can be cited
              // to, and the report layer refuses to print it for that reason.
              .update({ summary: line, summary_source: 'generated', summary_url: null })
              .eq('id', p.id);
            if (error) throw new Error(`generate write failed for ${p.name}: ${error.message}`);
          }
        }
      })
    );
    console.log(`GENERATED: ${generated}   left null (model said UNKNOWN or had nothing): ${stillNull}`);
  } else {
    stillNull = needModel.length;
  }

  const covered = derived + generated + manual;
  console.log(
    `\nCOVERAGE: ${covered} of ${projects.length} (${Math.round((covered / projects.length) * 100)}%)  null: ${projects.length - covered}`
  );

  console.log(`\n--- EXAMPLES ---`);
  for (const s of samples) {
    console.log(`\n[${s.src}] ${s.market}`);
    console.log(`  name:    ${s.name}`);
    console.log(`  summary: ${s.summary}`);
  }
  if (!APPLY) console.log('\nNothing was written. APPLY=1 to write.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
