// WHICH DELIVERED DOCUMENTS CARRY A CLIENT'S NAME AS THE PUBLISHER.
//
// BRAND-REPORT.md counted 21 in the first 1,000 of 1,690 rows and said so. That
// is a capped read, and standing rule 13 says a capped figure states its cap.
// This one is not capped: it pages the whole table, so the answer is a corpus
// answer and the 21 can be listed by id, by client and by date rather than
// estimated.
//
//     npm run diag:brand-deliveries

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { OPERATOR } from '../../../lib/operator';

async function pageAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(cols)
      .range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

interface Delivery {
  id: string;
  client_id: string | null;
  brand_name: string | null;
  addressee: string | null;
  document_type: string | null;
  delivery_status: string | null;
  file_path: string | null;
  generated_at: string | null;
}

interface Client {
  id: string;
  name: string | null;
  brand_name: string | null;
  addressee: string | null;
}

async function main() {
  const deliveries = await pageAll<Delivery>(
    'deliveries',
    'id,client_id,brand_name,addressee,document_type,delivery_status,file_path,generated_at'
  );
  const clients = await pageAll<Client>('clients', 'id,name,brand_name,addressee');
  const byId = new Map(clients.map((c) => [c.id, c]));

  console.log(`\nDELIVERIES: ${deliveries.length} rows read, WHOLE TABLE (paged, no cap).\n`);

  const byBrand = new Map<string, Delivery[]>();
  for (const d of deliveries) {
    const k = d.brand_name ?? '(null)';
    if (!byBrand.has(k)) byBrand.set(k, []);
    byBrand.get(k)!.push(d);
  }
  console.log('  brand_name on the delivery row:');
  for (const [k, rows] of [...byBrand.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const flag = k !== OPERATOR && k !== '(null)' ? '   <- NOT THE OPERATOR' : '';
    console.log(`    ${k.padEnd(24)} ${String(rows.length).padStart(5)}${flag}`);
  }

  // THE DEFECT SHAPE, stated as the golden case states it: a document whose
  // publisher is its recipient. Detected by comparing the delivery's brand to
  // the receiving client's OWN name, not by matching a literal.
  const misattributed = deliveries.filter((d) => {
    if (!d.brand_name || d.brand_name === OPERATOR) return false;
    const c = d.client_id ? byId.get(d.client_id) : null;
    if (!c) return true;
    return d.brand_name === c.name || d.brand_name === c.brand_name;
  });

  console.log(`\n  MISATTRIBUTED (publisher derived from recipient): ${misattributed.length}\n`);
  const perClient = new Map<string, number>();
  for (const d of misattributed) {
    const c = d.client_id ? byId.get(d.client_id) : null;
    const label = c?.name ?? `(no client: ${d.client_id ?? 'null'})`;
    perClient.set(label, (perClient.get(label) ?? 0) + 1);
  }
  for (const [k, n] of [...perClient.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    to ${k.padEnd(24)} ${n}`);
  }

  console.log('\n  The rows, in full:\n');
  console.log(
    `    ${'id'.padEnd(38)} ${'generated'.padEnd(11)} ${'document_type'.padEnd(28)} ${'status'.padEnd(10)} addressee`
  );
  for (const d of misattributed.sort((a, b) => (a.generated_at ?? '').localeCompare(b.generated_at ?? ''))) {
    console.log(
      `    ${String(d.id).padEnd(38)} ${(d.generated_at ?? '').slice(0, 10).padEnd(11)} ${(d.document_type ?? '-').padEnd(28)} ${(d.delivery_status ?? '-').padEnd(10)} ${d.addressee ?? '-'}`
    );
  }

  console.log('\n  CLIENTS, and what each would brand a document with today:\n');
  for (const c of clients) {
    console.log(
      `    ${(c.name ?? '(unnamed)').padEnd(24)} brand_name=${String(c.brand_name).padEnd(20)} addressee=${c.addressee ?? '(null)'}`
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
