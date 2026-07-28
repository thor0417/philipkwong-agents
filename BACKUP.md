# Backup and restore

The database is the only thing here that cannot be rebuilt from the repository.
The scrapers can always re-fetch, but Philip's triage decisions cannot: a status,
a note, and a manual override are judgements, not data any source can return.
That is what this protects.

## Taking a backup

```bash
node --env-file=.env.local --import tsx agents/scraper/migrations/backup-leads.ts
```

Writes one timestamped JSON Lines file per table into `backups/`:

```
backups/leads-2026-07-28T04-23-53-505Z.jsonl
```

One row per line, every column, no filtering. Dismissed rows are included, and
that is deliberate: dismissal is a status and the row still exists, so a backup
that dropped them would discard the tombstones that stop the scraper resurrecting
what Philip has already thrown out.

`projects` is exported the same way once the clustering phase creates it. Until
then the run reports it as skipped and carries on.

The row count in the file is compared with the row count in the live table before
the run reports success. A mismatch throws rather than leaving a plausible-looking
file behind.

Set `BACKUP_DIR` to write somewhere else:

```bash
BACKUP_DIR="/d/backups/philipkwong" node --env-file=.env.local --import tsx agents/scraper/migrations/backup-leads.ts
```

## Restoring

Always dry-run first:

```bash
DRY_RUN=1 node --env-file=.env.local --import tsx agents/scraper/migrations/restore-leads.ts backups/leads-<stamp>.jsonl
```

Then, to write:

```bash
node --env-file=.env.local --import tsx agents/scraper/migrations/restore-leads.ts backups/leads-<stamp>.jsonl
```

The restore upserts on `url`. That makes it safe against a live table: it repairs
missing or damaged rows and leaves everything else alone. It never deletes and
never truncates, so running it cannot make things worse than they already are.

To restore into an empty table (a new Supabase project, or after a disaster),
apply `supabase/schema.sql` and the migrations in `agents/scraper/migrations/`
first, then run the restore.

## Where backups should live

`backups/` is gitignored. The database contains client-identifying research and
must not be committed.

A backup that only exists on one laptop is not a backup. Keep at least two of:

1. **The working machine** - `backups/`, from a run before any bulk operation.
2. **A second physical location** - an external drive or a second machine. Copy
   the file across after each run; the export is a single file, so this is a
   drag and drop.
3. **Cloud storage** - OneDrive, Dropbox, or a private bucket. This repository
   already lives under OneDrive, so pointing `BACKUP_DIR` at a synced folder
   outside the repository gets offsite copies for free:

```bash
BACKUP_DIR="$HOME/OneDrive/philipkwong-backups" node --env-file=.env.local --import tsx agents/scraper/migrations/backup-leads.ts
```

Supabase also takes its own automatic backups on paid plans. Treat those as the
floor rather than the plan: they are point-in-time and controlled by the vendor,
whereas these files are portable and restorable anywhere.

## When to run it

- Before any bulk operation (a purge, a backfill, a migration).
- Before and after a triage sweep, which is when the irreplaceable judgements
  are created.
- Otherwise weekly.

## Verified

Run 2026-07-28: 1,281 rows exported to a 3,073 KB file, matching the 1,281 rows
in the live table exactly. A dry-run restore of that file read all 1,281 lines
with 0 malformed.
