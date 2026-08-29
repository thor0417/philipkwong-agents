// WHOSE PRODUCT THIS IS. One line, and it is not a setting.
//
// THE DEFECT THIS FILE EXISTS FOR. The document cover resolved its brand as
// `brandOverride || client.brand_name || 'Philip Kwong'`, so the operator's own
// name only won when the first two were empty. A client with a brand recorded
// therefore published the document it received: JKR & Associates' market report
// was branded by JKR, to JKR. Twenty-one delivered documents went out that way.
//
// The shape is not "the string was wrong". It is that a document's PUBLISHER was
// derived from its RECIPIENT. A client is an addressee and never a publisher, so
// there is no precedence chain here to get the order of: there is one value.
//
// IMPORT-FREE ON PURPOSE, and at the root, so both packages read one copy - the
// same rule as lib/dead-feeds, lib/corpus-scope and lib/market-standard. A brand
// mirrored in two places is a brand that can go stale on the half that prints
// it, and the half that prints it is the half a client reads.
//
// Changing this changes the name on every cover, every page footer, every
// workbook's metadata and every future delivery row. It is not per-client, not
// per-pipeline and not overridable; the control that used to allow that was
// deleted rather than fixed.

export const OPERATOR = 'Philip Kwong';
