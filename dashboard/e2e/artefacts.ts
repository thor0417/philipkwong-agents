// WHERE A TRACKED ARTEFACT GOES, AND WHY IT IS NOT ALWAYS THE TRACKED PATH.
//
// Two directories under e2e/shots are committed and the rest are ignored:
// documents/ is the product's actual output, and walkthrough/ is what
// WALKTHROUGH.md embeds plus the JSON every audit prints. Forty files. A full
// suite run rewrites thirty-five of them.
//
// THAT IS FINE WHEN A PERSON RUNS THE SUITE AND WRONG WHEN THE GATE DOES. The
// pre-push hook runs the whole suite on every push that touches the dashboard,
// so the moment a push succeeded the tree was dirty again - nineteen files on
// the run that prompted this, all of it churn: PDF byte sizes moving by single
// digits, and one watchlist count going 157 to 159 because the corpus advanced
// during the eighteen minutes between the two runs. The next session then opens
// on a modified working copy that looks like unfinished work and is not.
//
// The fix is not a note telling the next session to ignore a dirty tree, which
// teaches exactly the wrong habit. The gate writes somewhere else.
//
// E2E_SHOTS_ROOT DEFAULTS TO THE COMMITTED PATH, so an interactive run still
// updates what is committed and nothing about a normal capture changes. The
// hook sets it to e2e/shots/gate.
//
// WHY THAT VALUE AND NOT A SIBLING DIRECTORY: .gitignore already carries
// `dashboard/e2e/shots/*` with exactly two negations under it. Any new child of
// shots/ is ignored by the rule that is already there, so the gate's copy needs
// no .gitignore entry, no third negation, and no chance of a negation that
// silently fails the way the first one did before the children were excluded
// individually.
import path from 'node:path';

export const SHOTS_ROOT = process.env.E2E_SHOTS_ROOT ?? path.join('e2e', 'shots');

/** The directory the walkthrough captures and every audit's JSON are written to. */
export const walkthroughDir = () => path.join(SHOTS_ROOT, 'walkthrough');

/** One file inside it. */
export const walkthroughOut = (file: string) => path.join(walkthroughDir(), file);

// LIGHT AND DARK BOTH GENERATE AND ONLY LIGHT WRITES THE COMMITTED SET, because
// a PDF has no colour scheme. Dark's copy is scratch nobody reads, and it exists
// so the two capture projects never call saveAs on one path: at more than one
// worker that is a torn document rather than a wasted one. The convention is
// enforced by the golden case a-tracked-artefact-written-by-two-projects.
export const documentsDir = (mode: string) =>
  path.join(SHOTS_ROOT, mode === 'light' ? 'documents' : 'documents-dark');
