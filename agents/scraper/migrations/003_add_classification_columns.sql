-- 003: classification tags so the dashboard can organize leads by category and
-- subcategory (fuel: notice-type + product; consulting: work-type). Idempotent.
alter table leads add column if not exists category text;
alter table leads add column if not exists subcategory text;
alter table leads add column if not exists product_type text;
create index if not exists idx_leads_category on leads(category);
create index if not exists idx_leads_subcategory on leads(subcategory);
create index if not exists idx_leads_product_type on leads(product_type);
