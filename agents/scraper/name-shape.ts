// WHAT SHAPE A PROVISIONAL NAME IS.
//
// The naming rules live in project-naming. This file is the vocabulary the
// AUDIT uses to describe what is stored today, so that a rule can be costed
// against a named group rather than against a total. It classifies and it never
// renames; nothing in the write path imports it.
//
// The shapes came out of the 118 stored title-sourced names, not out of a
// taxonomy written in advance. The brief offered six candidate shapes - an
// instrument type, a resolution opening clause, a sentence fragment, a case
// number, a bare address, something else - and the measurement contradicted it
// in one important way: the largest group is none of those. It is a name the
// SOURCE published as a name, which was mis-filed as provisional because
// name_source could not tell a project-name column from an agenda line.

import { sourcePublishesProjectName } from './project-naming';

export type NameShape =
  | 'published-name'
  | 'tender-title'
  | 'press-headline'
  | 'agenda-residue'
  | 'opening-clause'
  | 'field-block'
  | 'instrument-label'
  | 'reference-suffix'
  | 'other';

export const SHAPE_LABELS: Record<NameShape, string> = {
  'published-name': "the source's own project name",
  'tender-title': 'a procurement notice title',
  'press-headline': 'a press headline',
  'agenda-residue': 'agenda-line scaffolding',
  'opening-clause': 'an instrument opening clause',
  'field-block': 'a clerk field block',
  'instrument-label': 'an instrument label plus a subject',
  'reference-suffix': 'a name plus a filing reference',
  other: 'something else',
};

export interface ShapeInput {
  name: string;
  // The title of the record the name was derived from: the project's earliest.
  sourceTitle: string | null;
  // That record's source id, and its stream.
  recordSource: string | null;
  stream: string | null;
  // The project's identity key, which says which signal clustered it.
  projectKey: string;
  // Does any record publish a "Project:" programme line?
  hasProgramme: boolean;
}

// Agenda scaffolding that survived cleaning: an applicant colon-prefix, a
// possible-action clause, a hearing label.
const AGENDA_RESIDUE =
  /\bapplicant\b|for possible action|possible action to|public hearing|abeyance|renotification|^[A-Z][A-Z ,&'.-]{6,}:\s/;

// An opening clause: the name begins on a participle or mid-sentence.
const OPENING_CLAUSE =
  /^(?:[a-z]|(?:approving|authorizing|providing|accepting|amending|adopting|establishing|creating|declaring|conduct|issuance|OF THE\b)\b)/;

const FIELD_BLOCK = /\b(?:From|Recommendation|Sponsors?|Attachments?)\s*:/;

const INSTRUMENT_LABEL =
  /^(?:liquor\s+license|bond\s+act|add[-\s]?on|license\s+application|special\s+event\s+permit)\b/i;

const REFERENCE_SUFFIX = /\((?=[^)]*\d)[A-Za-z0-9][A-Za-z0-9._\/-]*\)\s*$/;

export function classifyNameShape(input: ShapeInput): NameShape {
  const { name } = input;
  // ORDERED, MOST SPECIFIC FIRST, and provenance beats prose. Whether a name
  // came out of a project-name column is a fact about the adapter; whether it
  // reads like an opening clause is an inference about a string, and the fact
  // outranks the inference.
  if (sourcePublishesProjectName(input.recordSource)) {
    return REFERENCE_SUFFIX.test(name) ? 'reference-suffix' : 'published-name';
  }
  if (input.hasProgramme || input.projectKey.includes(':proj:')) return 'tender-title';
  if (input.stream === 'intelligence' || input.projectKey.startsWith('name:')) return 'press-headline';
  if (FIELD_BLOCK.test(name)) return 'field-block';
  if (INSTRUMENT_LABEL.test(name)) return 'instrument-label';
  if (AGENDA_RESIDUE.test(name)) return 'agenda-residue';
  if (OPENING_CLAUSE.test(name)) return 'opening-clause';
  if (REFERENCE_SUFFIX.test(name)) return 'reference-suffix';
  return 'other';
}
