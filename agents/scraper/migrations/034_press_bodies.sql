-- 034: ARTICLE BODIES AND THE FIGURES READ OUT OF THEM.
--
-- BLOCKING. Run this in the Supabase SQL editor before `npm run capture:press`
-- can store anything. Nothing in this repo runs DDL.
--
-- WHY IT EXISTS. The intelligence lane stores a headline and a Google result
-- snippet. Measured 2026-08-16 across all 239 stored press records: raw_content
-- runs 116 to 274 characters, median 182, and 100% of them are under 400. That
-- is a snippet ending in an ellipsis, not an article.
--
-- The cost of that is the first thing an operator looks for. Heart Hotel is 752
-- rooms and 29 storeys on a $70M parcel; we hold 15 press records about it and
-- not one of them carries a single figure. Metropolitan Park's own stored
-- headline reads "unveils 3 hotel towers" and the snippet beneath it carries no
-- figure at all. The facts are in article bodies we have never fetched.
--
-- WHY A COLUMN AND NOT raw_content. The obvious cheap move is to append the body
-- to raw_content, the way the Legistar contact block is appended. It would be a
-- mistake, and the reason is worth writing down so nobody tries it again:
-- raw_content is READ BY THE SYSTEM, not just by people. recordStage derives a
-- project's stage from it, project-naming derives a project's NAME from it, and
-- the two-tier gate decides admission on it. Appending several thousand words of
-- journalism to it would silently re-stage, re-name and re-gate the corpus, and
-- the change would look like a clustering bug months later.
--
-- A press body is evidence about a project. It is not the project's own text.
-- Separate column, separate meaning.
--
--   article_body        the extracted readable text, or NULL
--   article_fetched_at  when we last tried, so a retry can be scheduled rather
--                       than repeated blindly on every run
--   article_status      'ok' or the failure taxonomy from sources/article-body:
--                       blocked, not-found, server-error, rate-limited, timeout,
--                       network, not-html, paywalled, too-short, redirect-loop.
--                       A NAMED failure, because "we hold no body for this" and
--                       "the publisher refuses us" are different facts about our
--                       coverage and only one of them is worth retrying.
--   press_facts         the figures read out of the body, each carrying the
--                       verbatim string and the sentence it came from, so a
--                       reader can check any number without opening the page.
--
-- IDEMPOTENT. Safe to run twice.

alter table public.leads add column if not exists article_body       text;
alter table public.leads add column if not exists article_fetched_at timestamptz;
alter table public.leads add column if not exists article_status     text;
alter table public.leads add column if not exists press_facts        jsonb;

comment on column public.leads.article_body is
  'Readable text of a press article we hold a URL for. Evidence about the project, never the project''s own filing text. Not read by recordStage, project-naming or the gate.';
comment on column public.leads.article_status is
  'ok, or a named failure: blocked, not-found, server-error, rate-limited, timeout, network, not-html, paywalled, too-short, redirect-loop.';
comment on column public.leads.press_facts is
  'Array of {kind, display, value, sentence}. display is verbatim from article_body and is verified to appear in it before write.';

-- Retry scheduling reads this, and it is the only access pattern: "press records
-- that have never been tried, or were tried before X".
create index if not exists leads_article_fetched_at_idx
  on public.leads (article_fetched_at nulls first)
  where source = 'gli_serper';
