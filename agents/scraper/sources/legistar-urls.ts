// THE FOUR LEGISTAR URL SHAPES, AND THE ONE PARSER THAT INVERTS THEM.
//
// IMPORT-FREE ON PURPOSE. This file reaches nothing: no database, no network,
// no taxonomy. sources/legistar.ts cannot be imported by the golden suite
// because it pulls gate-decide and therefore supabase-admin, and verify:golden
// runs with no env and no network by design. A url shape is exactly the kind of
// thing that suite should be able to assert, so the shapes live here.
//
// AND BECAUSE THE PARSER MUST NOT DRIFT FROM THE BUILDERS. A parser for a url
// shape kept in a different file from the writer of that shape goes stale the
// day the shape changes, and the half that goes stale is the half deciding
// which matter gets re-read. Builders and parser, one file, one screen.

export function matterGateway(client: string, id: number): string {
  return `https://${client}.legistar.com/gateway.aspx?M=l&ID=${id}`;
}
export function eventGateway(client: string, id: number): string {
  return `https://${client}.legistar.com/gateway.aspx?M=e&ID=${id}`;
}
// Honest per-record fallbacks: a real public page for the jurisdiction, made
// unique per record with a fragment (ignored by the server, so the page still
// loads) so distinct records never collapse on the url dedup / upsert key.
export function legislationSearchUrl(client: string, id: number): string {
  return `https://${client}.legistar.com/Legislation.aspx#matter-${id}`;
}
export function calendarUrl(client: string, id: number): string {
  return `https://${client}.legistar.com/Calendar.aspx#event-${id}`;
}

/**
 * THE INVERSE OF THE TWO MATTER BUILDERS ABOVE.
 *
 * Returns the Legistar client id and matter id a stored URL carries, or null
 * when the URL is not a matter. Both shapes the adapter writes are handled:
 *   https://<client>.legistar.com/gateway.aspx?M=l&ID=<id>
 *   https://<client>.legistar.com/Legislation.aspx#matter-<id>
 *
 * EVENTS RESOLVE TO NULL, DELIBERATELY. `M=e` and `#event-` are meetings; they
 * have no attachment endpoint, and handing an EventId to the Matters API would
 * return some unrelated matter's documents and attach them to a meeting. The
 * ids share a namespace and nothing downstream could tell the difference, so
 * the honest negative is the answer. See migrations/repair-legistar-documents.
 */
export function matterRefFromUrl(url: string | null): { client: string; matterId: number } | null {
  if (!url) return null;
  const host = /^https?:\/\/([a-z0-9-]+)\.legistar\.com\//i.exec(url);
  if (!host) return null;
  const client = host[1].toLowerCase();
  // M=l, the matter gateway. Anchored on the whole parameter rather than on ID
  // alone, so the event gateway - identical but for one letter - cannot match.
  const gateway = /[?&]M=l&ID=(\d+)/i.exec(url);
  if (gateway) return { client, matterId: Number(gateway[1]) };
  const fragment = /#matter-(\d+)/i.exec(url);
  if (fragment) return { client, matterId: Number(fragment[1]) };
  return null;
}

