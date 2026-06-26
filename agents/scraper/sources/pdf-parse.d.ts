// Minimal type declaration for pdf-parse (no bundled types). We import the
// internal lib path to bypass index.js debug behaviour under ESM.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
  }
  function pdf(data: Buffer | Uint8Array): Promise<PdfParseResult>;
  export default pdf;
}
