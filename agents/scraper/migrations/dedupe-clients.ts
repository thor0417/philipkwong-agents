// One-off repair: collapse duplicate clients onto one row.
//
// WHAT HAPPENED. Eight identical "Simtec Attractions" rows, one per verification
// run. Two causes, and both had to be true:
//
//   THE SCREEN. e2e/clients.shots.ts decides whether to run the intake form by
//   asking whether the client's name is already visible. It asked before the
//   clients query had answered, so on a cold load the answer was "no" and it
//   onboarded the client again. A race in the harness, not in the product.
//
//   THE TABLE. clients has no uniqueness constraint, so nothing refused the
//   second write. That is the real defect: a harness bug should cost a wasted
//   run, not a corrupted client list.
//
// Migration 027 adds the constraint. This script cleans up what landed before
// it, and must be run BEFORE 027 or the constraint cannot be created.
//
// THE SURVIVOR IS THE OLDEST ROW, which is also the one every delivery already
// points at. Choosing the newest would mean rewriting eleven delivery rows to
// point somewhere else, and a delivery record that has been moved is a delivery
// record someone can argue about.
//
// CHILD ROWS ARE REASSIGNED, NOT DISCARDED, and then deduplicated: the seven
// duplicates each carry a byte-identical contact and scope, so moving all of
// them onto the survivor would replace one visible problem with eight invisible
// ones. A child is moved only if the survivor has nothing equivalent; otherwise
// it dies with its parent, which is the correct outcome for a copy.
//
// Dry by default. CLIENTS_APPLY=1 to write.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';

// The identity two client rows are compared on, and the same expression
// migration 027 indexes. Case and surrounding space are not identity: "Simtec
// Attractions" and "simtec attractions " are one client.
export function clientIdentity(name: string, organisation: string | null): string {
  return `${String(name ?? '').trim().toLowerCase()}|${String(organisation ?? '').trim().toLowerCase()}`;
}

interface Row {
  id: string;
  name: string;
  organisation: string | null;
  created_at: string;
  [k: string]: unknown;
}

export interface DedupeReport {
  clients: number;
  groups: { identity: string; survivor: string; duplicates: string[] }[];
  contactsMoved: number;
  contactsRedundant: number;
  scopesMoved: number;
  scopesRedundant: number;
  deliveriesMoved: number;
  clientsRemoved: number;
  failures: string[];
}

export async function run(apply: boolean): Promise<DedupeReport> {
  const report: DedupeReport = {
    clients: 0,
    groups: [],
    contactsMoved: 0,
    contactsRedundant: 0,
    scopesMoved: 0,
    scopesRedundant: 0,
    deliveriesMoved: 0,
    clientsRemoved: 0,
    failures: [],
  };

  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`clients read failed: ${error.message}`);
  const rows = (clients ?? []) as Row[];
  report.clients = rows.length;

  const { data: contacts } = await supabaseAdmin.from('client_contacts').select('*');
  const { data: scopes } = await supabaseAdmin.from('client_scopes').select('*');
  const { data: deliveries } = await supabaseAdmin.from('deliveries').select('id,client_id');
  const deliveryRows = (deliveries ?? []) as { id: string; client_id: string | null }[];

  const byIdentity = new Map<string, Row[]>();
  for (const r of rows) {
    const k = clientIdentity(r.name, r.organisation);
    if (!byIdentity.has(k)) byIdentity.set(k, []);
    byIdentity.get(k)!.push(r);
  }

  for (const [identity, group] of byIdentity) {
    if (group.length < 2) continue;
    const [survivor, ...dupes] = group; // ordered by created_at
    report.groups.push({ identity, survivor: survivor.id, duplicates: dupes.map((d) => d.id) });

    const survivorContacts = (contacts ?? []).filter((c: Row) => c.client_id === survivor.id);
    const survivorScopes = (scopes ?? []).filter((s: Row) => s.client_id === survivor.id);

    for (const dupe of dupes) {
      // Deliveries ALWAYS move. A delivery is the record that a document was
      // produced for this client, and losing one loses the commercial history.
      const dl = deliveryRows.filter((d) => d.client_id === dupe.id);
      for (const d of dl) {
        report.deliveriesMoved++;
        if (apply) {
          const { error: e } = await supabaseAdmin
            .from('deliveries')
            .update({ client_id: survivor.id })
            .eq('id', d.id);
          if (e) report.failures.push(`delivery ${d.id}: ${e.message}`);
        }
      }

      for (const c of (contacts ?? []).filter((x: Row) => x.client_id === dupe.id)) {
        const same = survivorContacts.some(
          (s: Row) =>
            String(s.name ?? '').trim().toLowerCase() === String(c.name ?? '').trim().toLowerCase() &&
            String(s.email ?? '').trim().toLowerCase() === String(c.email ?? '').trim().toLowerCase()
        );
        if (same) {
          report.contactsRedundant++;
          continue;
        }
        report.contactsMoved++;
        if (apply) {
          const { error: e } = await supabaseAdmin
            .from('client_contacts')
            .update({ client_id: survivor.id })
            .eq('id', c.id);
          if (e) report.failures.push(`contact ${c.id}: ${e.message}`);
        }
      }

      for (const s of (scopes ?? []).filter((x: Row) => x.client_id === dupe.id)) {
        // A scope is equivalent when it covers the same pipeline with the same
        // filters. One scope per pipeline is the model; a second identical one
        // is a copy, not a second area of coverage.
        const same = survivorScopes.some(
          (t: Row) =>
            t.pipeline_id === s.pipeline_id &&
            JSON.stringify([t.countries, t.regions, t.markets, t.streams, t.development_categories, t.venue_types, t.stages]) ===
              JSON.stringify([s.countries, s.regions, s.markets, s.streams, s.development_categories, s.venue_types, s.stages])
        );
        if (same) {
          report.scopesRedundant++;
          continue;
        }
        report.scopesMoved++;
        if (apply) {
          const { error: e } = await supabaseAdmin
            .from('client_scopes')
            .update({ client_id: survivor.id })
            .eq('id', s.id);
          if (e) report.failures.push(`scope ${s.id}: ${e.message}`);
        }
      }

      report.clientsRemoved++;
      if (apply) {
        // The remaining children cascade. Everything worth keeping has already
        // been moved off this row by the loops above.
        const { error: e } = await supabaseAdmin.from('clients').delete().eq('id', dupe.id);
        if (e) report.failures.push(`client ${dupe.id}: ${e.message}`);
      }
    }
  }

  return report;
}

function print(r: DedupeReport, apply: boolean): void {
  console.log('===== CLIENT DEDUPLICATION =====\n');
  console.log(`clients read:           ${r.clients}`);
  console.log(`duplicate groups:       ${r.groups.length}`);
  console.log(`clients to remove:      ${r.clientsRemoved}`);
  console.log(`deliveries reassigned:  ${r.deliveriesMoved}`);
  console.log(`contacts reassigned:    ${r.contactsMoved} (${r.contactsRedundant} redundant copies dropped with their parent)`);
  console.log(`scopes reassigned:      ${r.scopesMoved} (${r.scopesRedundant} redundant copies dropped with their parent)`);
  if (r.failures.length) {
    console.log(`\nFAILURES (${r.failures.length}):`);
    for (const f of r.failures) console.log(`  ${f}`);
  }
  for (const g of r.groups) {
    console.log(`\n  identity "${g.identity}"`);
    console.log(`    survivor:   ${g.survivor}`);
    for (const d of g.duplicates) console.log(`    duplicate:  ${d}`);
  }
  if (!apply) console.log('\nNothing was written. Re-run with CLIENTS_APPLY=1 to apply this plan.');
}

async function main(): Promise<void> {
  const apply = process.env.CLIENTS_APPLY === '1';
  print(await run(apply), apply);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
