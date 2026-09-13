/**
 * A deliberately small Markdown reader for Sam's answers.
 *
 * Sam writes prose with the occasional list, heading, emphasis, link, and
 * table - not arbitrary documents - so this covers exactly that and treats
 * anything else as text. It parses to a node tree that React renders as
 * elements (never as HTML), and it is fed partial text while an answer is
 * still streaming, so every rule has to degrade to plain text rather than
 * wait for a closing token.
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] };

export type BlockNode =
  | { type: "heading"; level: number; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "quote"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "table"; header: InlineNode[][]; rows: InlineNode[][][] }
  | { type: "rule" };

/** Only schemes that cannot execute script; anything else stays literal text. */
const safeHref = (href: string): string | null => {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[/#]/.test(trimmed)) return trimmed;
  return null;
};

interface Match {
  index: number;
  length: number;
  node: InlineNode;
}

const INLINE_RULES: Array<(text: string) => Match | null> = [
  (text) => {
    const match = /`([^`\n]+)`/.exec(text);
    return match ? { index: match.index, length: match[0].length, node: { type: "code", value: match[1] } } : null;
  },
  (text) => {
    const match = /\[([^\]\n]*)\]\(([^)\s]+)\)/.exec(text);
    if (!match) return null;
    const href = safeHref(match[2]);
    if (!href) return null;
    return {
      index: match.index,
      length: match[0].length,
      node: { type: "link", href, children: parseInline(match[1]) },
    };
  },
  (text) => {
    const match = /\*\*([^\n]+?)\*\*|__([^\n]+?)__/.exec(text);
    if (!match) return null;
    return {
      index: match.index,
      length: match[0].length,
      node: { type: "strong", children: parseInline(match[1] ?? match[2]) },
    };
  },
  (text) => {
    // Underscores only between word boundaries, so snake_case names survive.
    const match = /\*([^*\n]+?)\*|(?<![A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])/.exec(text);
    if (!match) return null;
    return {
      index: match.index,
      length: match[0].length,
      node: { type: "em", children: parseInline(match[1] ?? match[2]) },
    };
  },
];

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let rest = text;

  while (rest) {
    let earliest: Match | null = null;
    for (const rule of INLINE_RULES) {
      const match = rule(rest);
      if (match && (!earliest || match.index < earliest.index)) earliest = match;
    }
    if (!earliest) break;

    if (earliest.index > 0) nodes.push({ type: "text", value: rest.slice(0, earliest.index) });
    nodes.push(earliest.node);
    rest = rest.slice(earliest.index + earliest.length);
  }

  if (rest) nodes.push({ type: "text", value: rest });
  return nodes;
}

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d+[.)]\s+(.*)$/;
const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isTableDivider = (line: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
const cells = (line: string): string[] =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

export function parseMarkdown(source: string): BlockNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // Fenced code: an unterminated fence still renders, which matters mid-stream.
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) body.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", value: body.join("\n") });
      continue;
    }

    if (/^\s{0,3}(\*\s*\*\s*\*|-\s*-\s*-|_\s*_\s*_)[\s*\-_]*$/.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, children: parseInline(heading[2].trim()) });
      index += 1;
      continue;
    }

    if (isTableRow(line) && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const header = cells(line).map(parseInline);
      index += 2;
      const rows: InlineNode[][][] = [];
      while (index < lines.length && isTableRow(lines[index])) {
        rows.push(cells(lines[index++]).map(parseInline));
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: InlineNode[][] = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = isOrdered ? ORDERED.exec(current) : BULLET.exec(current);
        if (!match) break;
        items.push(parseInline(match[1].trim()));
        index += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }

    const quote = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (quote) {
      const body = [quote[1]];
      index += 1;
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        body.push(lines[index++].replace(/^\s{0,3}>\s?/, ""));
      }
      blocks.push({ type: "quote", children: parseInline(body.join(" ").trim()) });
      continue;
    }

    // Paragraph: consecutive plain lines, soft-wrapped into one flow.
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      if (
        !next.trim() ||
        BULLET.test(next) ||
        ORDERED.test(next) ||
        /^\s{0,3}(#{1,6})\s+/.test(next) ||
        /^\s*```/.test(next) ||
        /^\s{0,3}>\s?/.test(next) ||
        isTableRow(next)
      ) {
        break;
      }
      paragraph.push(next.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}
