'use client';

import { Fragment } from 'react';
import { cn, safeImageSrc } from '@/lib/utils';
import type { TextBlock } from '@/lib/ai-tools/blocks';

/** Render inline spans: `**bold**`, `*italic*`, and `` `code` ``. */
function renderInline(text: string, keyOffset = 0): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Order matters: backtick first (greedy-safe), then bold, then italic.
  const regex = /(`([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let key = keyOffset;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));

    if (match[0].startsWith('`')) {
      // inline code
      parts.push(
        <code
          key={key++}
          className="font-mono text-[12px] bg-muted px-1 py-0.5 rounded text-foreground/90"
        >
          {match[2]}
        </code>,
      );
    } else if (match[0].startsWith('**')) {
      parts.push(
        <strong key={key++} className="font-semibold">
          {match[3]}
        </strong>,
      );
    } else {
      parts.push(<em key={key++}>{match[4]}</em>);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

/**
 * Detect a text block that is nothing but a raw JSON object / array — usually
 * a tool-call argument blob the model leaked into its assistant text instead
 * of emitting via the proper tool_call channel. The renderer drops these so
 * the realtor doesn't see raw SDK plumbing in the chat. We only strip when
 * the ENTIRE message is JSON (with optional surrounding whitespace) — JSON
 * snippets inside prose still render verbatim.
 */
function isRawJsonLeak(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 4) return false;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    // Only strip object/array payloads. Bare strings / numbers / booleans
    // wrapped in brackets are exotic and worth surfacing literally.
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

/** Parse the full content string into React block-level nodes. */
function renderMarkdown(content: string, streaming?: boolean): React.ReactNode[] {
  // Drop pure-JSON leaks — usually a tool-call args blob the model emitted
  // as assistant text instead of through the tool_call channel. See
  // `isRawJsonLeak`. Partial JSON (still streaming, braces unbalanced)
  // falls through and renders — `JSON.parse` fails until it closes; once
  // it closes, the next render strips it. The flash is the price of
  // honoring tokens-in-flight; the alternative is to gate on `streaming`
  // and leak the final result.
  if (isRawJsonLeak(content)) {
    return [];
  }
  const nodes: React.ReactNode[] = [];
  const lines = content.split('\n');
  let i = 0;
  let keyCounter = 0;
  const key = () => keyCounter++;

  while (i < lines.length) {
    const line = lines[i];

    // ── Image: ![alt](url) on its own line ───────────────────────────────
    // Studio + integration tool results surface generated assets as
    // markdown image syntax; render them inline so the realtor sees the
    // image instead of a URL. Image must be the whole line — inline
    // images mixed with text aren't worth supporting yet.
    //
    // safeImageSrc rejects javascript: / data: schemes so a prompt-
    // injected `![x](javascript:alert(1))` won't even make it into a
    // src attribute. Modern browsers already refuse to execute those
    // in <img src>, but the belt is cheap.
    const imageMatch = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    if (imageMatch) {
      const safeSrc = safeImageSrc(imageMatch[2]);
      if (safeSrc) {
        const alt = imageMatch[1] || 'image';
        nodes.push(
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={key()}
            src={safeSrc}
            alt={alt}
            className="my-2 max-w-full rounded-lg border border-border/60"
          />,
        );
      }
      i++;
      continue;
    }

    // ── Fenced code block ────────────────────────────────────────────────
    if (line.trimStart().startsWith('```')) {
      const codeLines: string[] = [];
      i++; // skip opening fence
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      nodes.push(
        <pre
          key={key()}
          className="bg-muted rounded-lg p-3 overflow-x-auto font-mono text-[12px] text-foreground/90 my-2 whitespace-pre"
        >
          {codeLines.join('\n')}
        </pre>,
      );
      continue;
    }

    // ── Heading h1 ───────────────────────────────────────────────────────
    if (/^# /.test(line)) {
      nodes.push(
        <h1 key={key()} className="text-sm font-semibold text-foreground mt-3 mb-1">
          {renderInline(line.slice(2))}
        </h1>,
      );
      i++;
      continue;
    }

    // ── Heading h2 ───────────────────────────────────────────────────────
    if (/^## /.test(line)) {
      nodes.push(
        <h2 key={key()} className="text-sm font-semibold text-foreground mt-3 mb-1">
          {renderInline(line.slice(3))}
        </h2>,
      );
      i++;
      continue;
    }

    // ── Heading h3–h6 (h1 and h2 already handled above) ────────────────
    if (/^#{3,6} /.test(line)) {
      const match = line.match(/^#{3,6} (.*)/);
      if (match) {
        nodes.push(
          <h3 key={key()} className="text-sm font-semibold text-foreground mt-3 mb-1">
            {renderInline(match[1])}
          </h3>,
        );
        i++;
        continue;
      }
    }

    // ── Unordered list ───────────────────────────────────────────────────
    // Tolerate blank lines between bullets — the agent often emits markdown
    // with one-line gaps and we want a SINGLE <ul>, not several one-item
    // lists rendered as separate hairline blocks.
    if (/^[-*] /.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (/^[-*] /.test(cur)) {
          items.push(
            <li key={key()} className="text-sm text-foreground">
              {renderInline(cur.slice(2))}
            </li>,
          );
          i++;
          continue;
        }
        if (cur.trim() === '') {
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === '') j++;
          if (j < lines.length && /^[-*] /.test(lines[j])) {
            i = j;
            continue;
          }
        }
        break;
      }
      nodes.push(
        <ul key={key()} className="list-disc pl-4 space-y-0.5 my-1">
          {items}
        </ul>,
      );
      continue;
    }

    // ── Ordered list ─────────────────────────────────────────────────────
    // Two corrections vs the previous version:
    //   1. Tolerate blank lines between items. Without this, "1. foo\n\n
    //      2. bar\n\n3. baz" rendered as THREE <ol>s of one item each, and
    //      browsers reset the counter on every <ol> → "1.", "1.", "1.".
    //   2. Honor the first item's number via the `start` attribute so a
    //      list that begins at "3." renders 3, 4, 5 — not 1, 2, 3.
    const olStartMatch = /^(\d+)\. /.exec(line);
    if (olStartMatch) {
      const startNum = parseInt(olStartMatch[1], 10);
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (/^\d+\. /.test(cur)) {
          items.push(
            <li key={key()} className="text-sm text-foreground">
              {renderInline(cur.replace(/^\d+\. /, ''))}
            </li>,
          );
          i++;
          continue;
        }
        if (cur.trim() === '') {
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === '') j++;
          if (j < lines.length && /^\d+\. /.test(lines[j])) {
            i = j;
            continue;
          }
        }
        break;
      }
      nodes.push(
        <ol
          key={key()}
          start={Number.isFinite(startNum) && startNum > 0 ? startNum : undefined}
          className="list-decimal pl-4 space-y-0.5 my-1"
        >
          {items}
        </ol>,
      );
      continue;
    }

    // ── Blank line → paragraph break ─────────────────────────────────────
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ── Paragraph: collect consecutive non-blank, non-block lines ────────
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,6} /.test(lines[i]) &&
      !/^[-*] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) &&
      !lines[i].trimStart().startsWith('```')
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      // Determine if this is the last node (for cursor placement).
      const isLast = i >= lines.length;
      nodes.push(
        <p key={key()} className="text-sm text-foreground leading-relaxed mb-2">
          {paraLines.map((pl, pi) => (
            <Fragment key={pi}>
              {renderInline(pl)}
              {pi < paraLines.length - 1 && <br />}
            </Fragment>
          ))}
          {isLast && streaming && (
            <span className="chippi-cursor" aria-hidden="true" />
          )}
        </p>,
      );
    }
    continue;
  }

  return nodes;
}

interface TextBlockViewProps {
  block: TextBlock;
  /** Whether the text is still streaming — shows a blinking caret. */
  streaming?: boolean;
  /** Whether this is the user's turn or the assistant's. */
  role?: 'user' | 'assistant';
  className?: string;
}

export function TextBlockView({
  block,
  streaming,
  role = 'assistant',
  className,
}: TextBlockViewProps) {
  if (role === 'user') {
    return (
      <div className={cn('flex justify-end', className)}>
        <div className="max-w-[75%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm text-foreground">
          <p className="whitespace-pre-wrap leading-relaxed">
            {block.content.split('\n').map((line, i, arr) => (
              <Fragment key={i}>
                {renderInline(line)}
                {i < arr.length - 1 && '\n'}
              </Fragment>
            ))}
          </p>
        </div>
      </div>
    );
  }

  const nodes = renderMarkdown(block.content, streaming);

  // If streaming and content ends with a block element (list, heading, pre),
  // the cursor won't have been appended inside a paragraph — append it as a
  // trailing inline span so it's always visible.
  const lastNode = nodes[nodes.length - 1];
  const lastIsPara =
    lastNode != null &&
    typeof lastNode === 'object' &&
    'type' in (lastNode as React.ReactElement) &&
    (lastNode as React.ReactElement).type === 'p';
  const needsTrailingCursor = streaming && !lastIsPara;

  return (
    <div
      // aria-live "polite" announces streaming deltas without interrupting;
      // aria-atomic=false means screen readers read appended text only.
      // Only the *streaming* block needs live semantics — static history
      // should stay silent so reload doesn't re-read the whole transcript.
      aria-live={streaming ? 'polite' : undefined}
      aria-atomic={streaming ? false : undefined}
      className={cn('text-sm text-foreground leading-relaxed', className)}
    >
      {nodes}
      {needsTrailingCursor && (
        <span className="chippi-cursor" aria-hidden="true" />
      )}
    </div>
  );
}
