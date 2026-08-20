// READ-ONLY. PRINT THE TEXT OF A GENERATED PDF, SO IT CAN BE READ BACK.
//
//   node --import tsx agents/scraper/diagnostics/read-pdf.ts <path.pdf>
//
// Standing rule 9: done means a generated document READ BACK. The documents this
// system produces are PDFs, and until this existed the only way to check one was
// to open it by hand - which meant a claim about a brief could not be checked
// inside a session at all, and "the brief reads well" was an assertion nobody
// could test.
//
// It reads what a client would read, not what the model intended: the text as
// the renderer laid it out, wrapping and repetition included. Three of the six
// referral-brief blemishes found on 2026-08-20 are only visible this way - 51
// identical citations, one press sentence quoted across three fact rows, and a
// withholding line printed twice in two wordings - because each of them is a
// property of the PAGE and not of the model behind it.

import { readFileSync } from 'node:fs';
import pdf from 'pdf-parse/lib/pdf-parse.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: read-pdf.ts <path.pdf>');
  process.exit(1);
}

async function main(): Promise<void> {
  const data = await pdf(readFileSync(file));
  console.log(data.text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
