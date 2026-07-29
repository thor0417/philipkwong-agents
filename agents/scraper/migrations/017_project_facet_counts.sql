-- Migration 017: grouped facet counts for PROJECTS, server-side.
--
-- The same need migration 015 answered for leads, now for the register: the
-- stage chips and the geography levels each show a count, and those counts must
-- come from the database. Counting loaded rows is loading the table by the back
-- door, which is exactly what the register exists to stop doing.
--
-- PostgREST aggregate functions are disabled on this project (`select=stage,
-- count()` is refused with "Use of aggregate functions is not allowed"), so the
-- GROUP BY lives here: one indexed query per facet, whatever the table size.
--
-- UNTIL THIS IS APPLIED the register still works. It falls back to selecting the
-- single facet column for the current filter - never row bodies - and prints
-- "client-grouped (migration 017 not applied)" in the footer, so the interim
-- cost is visible rather than hidden. At 175 projects that fallback is free; it
-- should not survive to 1,500.
--
-- SECURITY. STABLE and SECURITY INVOKER (the default), so it runs as the calling
-- user and any row-level security on projects applies exactly as it does to a
-- normal select. It reads only; it writes nothing.

create or replace function project_facet_counts(
  p_field text,
  p_module text default 'gli',
  p_stage text default null,
  p_country text default null,
  p_region_state text default null,
  p_market text default null,
  p_development_category text default null,
  p_status text default null,
  p_exclude_status text default null,
  p_watch boolean default null,
  p_active_from timestamptz default null,
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
    'stage', 'country', 'region_state', 'market', 'development_category', 'status'
  ) then
    raise exception 'project_facet_counts: unsupported field %', p_field;
  end if;

  return query execute format($f$
    select %I::text as value, count(*)::bigint as count
    from projects
    where %I is not null
      and ($1  is null or module = $1)
      and ($2  is null or stage = $2)
      and ($3  is null or country = $3)
      and ($4  is null or region_state = $4)
      and ($5  is null or market = $5)
      and ($6  is null or development_category = $6)
      and ($7  is null or status = $7)
      and ($8  is null or status is distinct from $8)
      and ($9  is null or watch = $9)
      and ($10 is null or last_activity >= $10)
      and ($11 is null or (
            name                   ilike '%%' || $11 || '%%'
         or primary_applicant      ilike '%%' || $11 || '%%'
         or primary_representative ilike '%%' || $11 || '%%'
      ))
    group by 1
    order by 2 desc, 1 asc
  $f$, p_field, p_field)
  using p_module, p_stage, p_country, p_region_state, p_market,
        p_development_category, p_status, p_exclude_status, p_watch,
        p_active_from, p_search;
end;
$$;

grant execute on function project_facet_counts(
  text, text, text, text, text, text, text, text, text, boolean, timestamptz, text
) to authenticated;
