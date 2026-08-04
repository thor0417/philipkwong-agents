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
// THE SEED. The registry is a network read, and the shell has to paint a
// wordmark on the first frame. PIPELINE_SEED is a mirror of the live row used
// only until the real one arrives; it is the same trick, and the same trade-off,
// as dashboard/lib/taxonomy.ts mirroring the root taxonomy. If it ever drifts
// the only symptom is a correct label arriving a frame late.

import type { Pipeline } from './pipelines';

// The operator. Not a pipeline label: this is whose product it is, and it does
// not change when the pipeline does. Here so it is stated once.
export const OPERATOR = 'Philip Kwong';

export const PIPELINE_SEED: Pipeline = {
  id: 'hospitality',
  name: 'Hospitality and Entertainment',
  short_name: 'Hospitality',
  brand_name: 'JKR & Associates',
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
  /** The client this pipeline is worked for, if any. */
  clientName: string | null;
  /** Operator and pipeline, for the shell wordmark. */
  wordmark: string;
  /** Operator and client, for anything that leaves the building. */
  deliveryLine: string;
  /** Title for an exported report or workbook. */
  reportTitle: string;
}

export function brandFor(pipeline: Pipeline): Brand {
  const client = pipeline.brand_name;
  return {
    pipelineName: pipeline.name,
    pipelineShort: pipeline.short_name,
    clientName: client,
    wordmark: `${OPERATOR} / ${pipeline.short_name}`,
    // Falls back to the operator alone rather than printing a dangling slash
    // when a pipeline has no client.
    deliveryLine: client ? `${OPERATOR} / ${client}` : OPERATOR,
    reportTitle: `${pipeline.name} Development Intelligence`,
  };
}

export const SEED_BRAND: Brand = brandFor(PIPELINE_SEED);
