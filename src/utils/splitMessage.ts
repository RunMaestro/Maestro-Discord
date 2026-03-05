const MAX_LENGTH = 1990; // small buffer below 2000

/**
 * Split a string into chunks that fit within Discord's message length limit.
 * Tries to split on newlines when possible to preserve formatting.
 */
export function splitMessage(text: string): string[] {
  if (text.length <= MAX_LENGTH) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_LENGTH) {
    // Try to find a newline to break on within the limit
    let splitAt = remaining.lastIndexOf('\n', MAX_LENGTH);
    if (splitAt <= 0) splitAt = MAX_LENGTH; // fallback: hard cut

    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) parts.push(remaining);
  return parts;
}
