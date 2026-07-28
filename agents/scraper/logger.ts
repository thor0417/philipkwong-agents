// STRUCTURED LOGGING. pino, with pino-pretty in development.
//
// The split, made deliberately:
//
//   EVENTS go through the logger. Anything a machine will want later: a lane
//   starting or finishing, a source fetched, records rejected by schema, a write
//   refused by a tombstone, an error. These carry fields, not sentences, so they
//   can be queried when the observability phase lands.
//
//   REPORTS stay on console. The aligned tables at the end of a run (gate
//   telemetry per jurisdiction, per venue type, the sample rows) are a formatted
//   document for a person to read, not a stream of records. Forcing them through
//   a log line would destroy the readability the brief calls non-negotiable, and
//   would gain nothing: nobody queries a table of dashes.
//
// LOG_LEVEL sets the level (default info). LOG_JSON=1 forces raw JSON even in
// development, which is how the structured line is inspected without deploying.

import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const forceJson = process.env.LOG_JSON === '1';
const level = process.env.LOG_LEVEL ?? 'info';

export const logger =
  isProduction || forceJson
    ? pino({ level })
    : pino({
        level,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
            messageFormat: '{msg}',
          },
        },
      });

// A child logger bound to one lane, so every line it emits carries the lane.
export function laneLogger(lane: string): pino.Logger {
  return logger.child({ lane });
}

// ---- the run summary --------------------------------------------------------
// The shape below is the seed of the health record in the observability phase.
// It is deliberately flat and deliberately the same for every lane, so a week of
// runs can be compared without special-casing per lane. Add fields; do not
// rename these.
export interface RunSummary {
  lane: string;
  started: string;
  finished: string;
  durationMs: number;
  // What the sources returned before any gate.
  fetched: number;
  // What passed the lane's gate.
  matched: number;
  // What reached the database.
  written: number;
  // Everything deliberately not written, by reason.
  skipped: number;
  // Anything that failed: a write error, an unparseable document.
  failed: number;
  // Optional per-lane detail, kept out of the flat fields above so the shape
  // stays stable: schema rejections, tombstone skips, per-jurisdiction counts.
  detail?: Record<string, unknown>;
}

// Time a lane and emit its summary. The returned object is also handed back so a
// caller can assert on it in a test or print it in a report.
export class RunTimer {
  private readonly startedAt = new Date();
  private readonly log: pino.Logger;

  constructor(private readonly lane: string) {
    this.log = laneLogger(lane);
    this.log.info({ event: 'lane.start', started: this.startedAt.toISOString() }, `${lane} starting`);
  }

  get logger(): pino.Logger {
    return this.log;
  }

  finish(counts: {
    fetched: number;
    matched: number;
    written: number;
    skipped?: number;
    failed?: number;
    detail?: Record<string, unknown>;
  }): RunSummary {
    const finishedAt = new Date();
    const summary: RunSummary = {
      lane: this.lane,
      started: this.startedAt.toISOString(),
      finished: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - this.startedAt.getTime(),
      fetched: counts.fetched,
      matched: counts.matched,
      written: counts.written,
      skipped: counts.skipped ?? 0,
      failed: counts.failed ?? 0,
      detail: counts.detail,
    };
    this.log.info({ event: 'lane.summary', summary }, `${this.lane} finished`);
    return summary;
  }
}
