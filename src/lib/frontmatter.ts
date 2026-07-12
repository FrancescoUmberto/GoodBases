/**
 * Split a note's raw markdown into its frontmatter block and its body.
 * The frontmatter (when present) is returned verbatim — opening `---`,
 * closing `---`, and trailing newline included — so callers can rewrite
 * the body while preserving the properties byte-for-byte.
 */
export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
	const match = raw.match(/^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/);
	if (!match) return { frontmatter: '', body: raw };
	return { frontmatter: match[0], body: raw.slice(match[0].length) };
}
