const WORD_QUERY_PATTERN = /^[a-z]+(?:['’][a-z]+)*(?:-[a-z]+(?:['’][a-z]+)*)*$/;

export function normalizeWord(raw: string): string {
  // Word processors auto-convert to curly apostrophes; fold them so
  // "don’t" and "don't" are the same word for storage, grading, and dedupe.
  return raw.trim().replace(/\s+/g, " ").replace(/[’ʼ]/g, "'").toLowerCase();
}

export function isValidWordQuery(query: string): boolean {
  return WORD_QUERY_PATTERN.test(query);
}
