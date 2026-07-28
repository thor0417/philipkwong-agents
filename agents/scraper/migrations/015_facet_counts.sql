-- Migration 015: grouped facet counts, server-side.
--
-- WHY THIS IS NEEDED. The dashboard's navigation shows a count at every level
-- (country, then state, then market) and on every chip (category, venue). Those
-- counts must come from the database, not from counting loaded rows, or the
-- dashboard is loading the table again by the back door.
--
-- PostgREST aggregate functions are disabled on this project, so `select=
-- country,count()` is refused ("Use of aggregate functions is not allowed").
-- This function does the GROUP BY in Postgres instead: one indexed query per
-- facet, whatever the table size.
--
-- Until this is applied the dashboard falls back to selecting the single facet
-- column and grouping in the browser. That still never loads row bodies, and the
-- UI reports which path it used, but it is O(rows) and should not survive to
-- 20,000 records.
--
-- SECURITY. Declared STABLE and SECURITY INVOKER (the default), so it runs as
-- the calling user and the existing row-level security policy on leads applies
-- exactly as it does to a normal select. It reads only; it writes nothing.

create or replace function facet_counts(
  p_field text,
  p_module text default null,
  p_stream text default null,
  p_country text default null,
  p_region_state text default null,
  p_market text default null,
  p_development_category text default null,
  p_venue_type text default null,
  p_status text default null,
  p_exclude_status text default null,
  p_lifecycle text default null,
  p_first_seen_from timestamptz default null,
  p_search text default null
)
returns table (value text, count bigint)
language plpgsql
stable
as $$
begin
  -- Whitelist the facet column. The parameter names a column, so it cannot be
  -- interpolated without this check.
  if p_field not in (
    'country', 'region_state', 'market', 'development_category', 'venue_type', 'status'
  ) then
    raise exception 'facet_counts: unsupported field %', p_field;
  end if;

  return query execute format($f$
    select %I::text as value, count(*)::bigint as count
    from leads
    where %I is not null
      and ($1  is null or module = $1)
      and ($2  is null or stream = $2)
      and ($3  is null or country = $3)
      and ($4  is null or region_state = $4)
      and ($5  is null or market = $5)
      and ($6  is null or development_category = $6)
      and ($7  is null or venue_type = $7)
      and ($8  is null or status = $8)
      and ($9  is null or status is distinct from $9)
      and ($10 is null or lifecycle = $10)
      and ($11 is null or first_seen >= $11)
      and ($12 is null or (
            title            ilike '%%' || $12 || '%%'
         or applicant        ilike '%%' || $12 || '%%'
         or representative   ilike '%%' || $12 || '%%'
         or presented_by     ilike '%%' || $12 || '%%'
         or action_sought    ilike '%%' || $12 || '%%'
         or location         ilike '%%' || $12 || '%%'
         or market           ilike '%%' || $12 || '%%'
         or company          ilike '%%' || $12 || '%%'
      ))
    group by 1
    order by 2 desc, 1 asc
  $f$, p_field, p_field)
  using p_module, p_stream, p_country, p_region_state, p_market,
        p_development_category, p_venue_type, p_status, p_exclude_status,
        p_lifecycle, p_first_seen_from, p_search;
end;
$$;

-- Let the dashboard's authenticated role call it.
grant execute on function facet_counts(
  text, text, text, text, text, text, text, text, text, text, text, timestamptz, text
) to authenticated;
