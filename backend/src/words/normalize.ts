const WORD_QUERY_PATTERN = /^[a-z]+(?:['’][a-z]+)*(?:-[a-z]+(?:['’][a-z]+)*)*$/;

export function normalizeWord(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isValidWordQuery(query: string): boolean {
  return WORD_QUERY_PATTERN.test(query);
}
