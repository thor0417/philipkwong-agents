// Minimal type declaration for pdf-parse (no bundled types). We import the
// internal lib path to bypass index.js debug behaviour under ESM.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
  }
  interface PdfPageTextItem {
    str: string;
    transform: number[];
    hasEOL?: boolean;
  }
  interface PdfPageData {
    getTextContent(opts?: {
      normalizeWhitespace?: boolean;
      disableCombineTextItems?: boolean;
    }): Promise<{ items: PdfPageTextItem[] }>;
  }
  interface PdfParseOptions {
    // Called once per page; its returned string is concatenated into result.text.
    pagerender?: (pageData: PdfPageData) => Promise<string> | string;
    // Max pages to parse (0 = all).
    max?: number;
  }
  function pdf(data: Buffer | Uint8Array, options?: PdfParseOptions): Promise<PdfParseResult>;
  export default pdf;
}
