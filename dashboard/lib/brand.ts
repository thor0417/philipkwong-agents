// BRAND AND PIPELINE LABELS, RESOLVED FROM CONFIG.
//
// Before this file, "GLI" and "Grant Leisure International" were typed into
// eleven places across components, a PDF renderer and an XLSX builder. Both are
// now wrong: the pipeline is Hospitality and Entertainment, and JKR & Associates
// is a client. Fixing that by retyping eleven literals would leave the same
// problem in place for the next rename.
//
// So no component may contain a pipeline or brand name. Every label comes from
// the `pipelines` registry table, which is the authority, and a second pipeline
// therefore needs no component change at all.
//
// ---- AND THEN IT ENCODED THE SAME ERROR ONE LEVEL UP ------------------------
//
// The header above diagnosed the problem exactly - "JKR & Associates is a
// client" - and the file then read `pipeline.brand_name`, a CLIENT name sitting
// in a PIPELINE's brand field, and printed it on every delivery line as
// "Philip Kwong / JKR & Associates". The returned field was even called
// `clientName`. The model was right and the value in it was a client's.
//
// THE PUBLISHER IS NOW ONE VALUE AND IT IS NOT A SETTING. `OPERATOR` moved to
// an import-free root module both packages read, and is re-exported here so the
// dashboard's existing callers do not each grow a cross-split relative import.
// `pipeline.brand_name` is read by nothing.
//
// THE SEED. The registry is a network read, and the shell has to paint a
// wordmark on the first frame. PIPELINE_SEED is a mirror of the live row used
// only until the real one arrives; it is the same trick, and the same trade-off,
// as dashboard/lib/taxonomy.ts mirroring the root taxonomy. If it ever drifts
// the only symptom is a correct label arriving a frame late.

import type { Pipeline } from './pipelines';
// ONE COPY, at the repo root, read by both packages. Import-free, so it may
// cross the split - the same rule as lib/dead-feeds.
import { OPERATOR } from '../../lib/operator';

export { OPERATOR };

export const PIPELINE_SEED: Pipeline = {
  id: 'hospitality',
  name: 'Hospitality and Entertainment',
  short_name: 'Hospitality',
  // A CLIENT'S NAME NEVER SAT WELL HERE AND NOW SITS NOWHERE. Both columns are
  // read by nothing and are dropped by migration 046.
  brand_name: null,
  brand_logo: null,
  active: true,
  retired_reason: null,
  sort_order: 1,
};

export interface Brand {
  /** The pipeline, in full. Page titles and report headers. */
  pipelineName: string;
  /** The pipeline, short. Wordmarks, nav, anywhere width is scarce. */
  pipelineShort: string;
  /**
   * WAS: the client this pipeline is worked for. Now always null and kept only
   * so the shape does not shift under existing callers. A pipeline is not
   * worked FOR a client - clients are scoped onto it, several at a time - and
   * treating one of them as the pipeline's owner is what put a recipient's name
   * on the publisher's line.
   */
  clientName: null;
  /** Operator and pipeline, for the shell wordmark. */
  wordmark: string;
  /** Operator and client, for anything that leaves the building. */
  deliveryLine: string;
  /** Title for an exported report or workbook. */
  reportTitle: string;
}

export function brandFor(pipeline: Pipeline): Brand {
  return {
    pipelineName: pipeline.name,
    pipelineShort: pipeline.short_name,
    clientName: null,
    wordmark: `${OPERATOR} / ${pipeline.short_name}`,
    // THE DELIVERY LINE IS THE OPERATOR, FULL STOP. It used to append
    // `pipeline.brand_name`, so the records export's cover, its page footer and
    // the workbook's own file metadata all read "Philip Kwong / JKR &
    // Associates" whoever the export was for. A document that names a client as
    // its publisher is wrong even when that client is the one reading it.
    deliveryLine: OPERATOR,
    reportTitle: `${pipeline.name} Development Intelligence`,
  };
}

export const SEED_BRAND: Brand = brandFor(PIPELINE_SEED);
