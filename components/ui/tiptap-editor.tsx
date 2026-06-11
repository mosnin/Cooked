'use client';

/**
 * TiptapEditor — the canonical "Google Docs"-style rich text editor.
 *
 * Built on ProseMirror via TipTap. Headless — toolbar is hand-rolled to
 * match Chippi's paper-flat surface (no shadcn dropdowns, no third-party
 * chrome that would drag its own design with it).
 *
 * Contract — drop-in replacement for the existing `value`/`onChange`
 * RichTextEditor in /broker/settings:
 *   - value: HTML string (initialContent)
 *   - onChange: called with HTML string on each update
 *
 * Extensions:
 *   - StarterKit                       (bold, italic, strike, code, headings, lists, blockquote, codeBlock)
 *   - Underline                        (StarterKit doesn't ship underline)
 *   - Link (auto target=_blank, rel)
 *   - Placeholder
 *   - Typography                       (smart quotes, em-dash, ellipsis on the fly)
 *
 * Stylesheet anchors:
 *   - Body type uses Tailwind's `prose` so headings inherit Chippi's
 *     SF Pro Display stack (via the base layer's `<h*>` rules) and body
 *     reads at the canonical `text-sm`.
 *   - Toolbar: hairline border (`border-border/60`), `bg-muted/30` shell,
 *     ghost-button hover (`hover:bg-foreground/[0.04]`) — the same row
 *     vocabulary as the rest of the dashboard.
 *   - Radius: `rounded-md` on toolbar buttons (canonical control radius),
 *     `rounded-xl` on the editor frame (canonical content radius).
 *   - Mobile: only Bold/Italic/Link/Undo stay inline; the rest tuck behind
 *     a More button so the toolbar stops pushing the document below the
 *     fold on a phone.
 *   - Read mode (`disabled={true}`) tints the body `bg-muted/10` so the
 *     realtor can tell at a glance whether they're viewing or editing.
 */

import { useCallback, useEffect, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Code2,
  Link as LinkIcon,
  Unlink,
  Undo2,
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TiptapEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** When true, the toolbar is hidden — the editor is still interactive.
   *  Used inside the Preview/Edit toggle so we don't double-render chrome
   *  if a parent wants to drive the toolbar itself. */
  hideToolbar?: boolean;
}

export function TiptapEditor({
  value,
  onChange,
  placeholder = 'Start typing…',
  className,
  disabled = false,
  hideToolbar = false,
}: TiptapEditorProps) {
  const editor = useEditor({
    // TipTap warns about SSR hydration mismatches if the editor is
    // instantiated on the server. The parent already loads us via
    // next/dynamic with ssr:false, but this is the seatbelt.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // StarterKit ships an internal Link too — disable it since we're
        // configuring the standalone Link extension below with target=_blank.
        link: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      Placeholder.configure({ placeholder }),
      Typography,
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: cn(
          // The editor body. Match the existing document textarea height
          // so the realtor doesn't feel a layout jump when toggling.
          'min-h-[60vh] px-3.5 py-3 outline-none',
          // `prose` gives us Google-Docs-style body type for free. Use
          // the small scale because the rest of the dashboard reads at
          // text-sm — `prose` defaults to text-base which feels alien
          // inside the surface.
          'prose prose-sm dark:prose-invert max-w-none',
          // Per stylesheet: no shadows, just hairlines. Override prose's
          // default link blue — Chippi links are foreground underline.
          'prose-a:text-foreground prose-a:underline',
          'prose-code:before:content-none prose-code:after:content-none',
          'prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded',
        ),
      },
    },
  });

  // External value changes (e.g. loading an existing document into a
  // freshly-mounted editor) need to be reflected. We only set content
  // when the value diverges from what the editor currently holds —
  // otherwise we'd reset the selection on every keystroke.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === value) return;
    editor.commands.setContent(value || '', { emitUpdate: false });
  }, [editor, value]);

  // Honor live `disabled` toggles (Preview mode flips this).
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div
      className={cn(
        'rounded-xl border border-border/70 overflow-hidden',
        // Read mode: subtle muted tint so the realtor can tell at a glance
        // whether they're viewing or editing. Edit mode: paper-flat card.
        disabled ? 'bg-muted/10' : 'bg-card',
        className,
      )}
    >
      {!hideToolbar && editor && <Toolbar editor={editor} disabled={disabled} />}
      <EditorContent editor={editor} />
    </div>
  );
}

/** Hand-rolled toolbar — kept in this file so the editor ships as a
 *  single unit. The icons + button density match the existing dashboard
 *  toolbars (chip-prompt-box, kanban filter row). On mobile, only the
 *  four most-used actions (bold, italic, link, undo) stay inline; the
 *  rest tuck behind a More button. */
function Toolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  // The toolbar re-renders on every editor transaction so active-state
  // marks (e.g. cursor inside <strong>) stay in sync. Cheap — TipTap is
  // already running these checks internally.
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const tick = () => force((n) => n + 1);
    editor.on('selectionUpdate', tick);
    editor.on('transaction', tick);
    return () => {
      editor.off('selectionUpdate', tick);
      editor.off('transaction', tick);
    };
  }, [editor]);

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border/60 bg-muted/30 flex-wrap">
      {/* Inline on every breakpoint — the four most-used actions. */}
      <Btn
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (Ctrl/Cmd+B)"
        disabled={disabled}
      >
        <Bold size={14} />
      </Btn>
      <Btn
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (Ctrl/Cmd+I)"
        disabled={disabled}
      >
        <Italic size={14} />
      </Btn>

      {/* sm+ — the rest of the formatting row. Hidden on phones. */}
      <Btn
        className="hidden sm:inline-flex"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline (Ctrl/Cmd+U)"
        disabled={disabled}
      >
        <UnderlineIcon size={14} />
      </Btn>
      <Btn
        className="hidden sm:inline-flex"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
        disabled={disabled}
      >
        <Strikethrough size={14} />
      </Btn>

      <Divider className="hidden sm:inline-block" />

      <Btn
        className="hidden sm:inline-flex"
        active={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
        disabled={disabled}
      >
        <Heading1 size={14} />
      </Btn>
      <Btn
        className="hidden sm:inline-flex"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
        disabled={disabled}
      >
        <Heading2 size={14} />
      </Btn>
      <Btn
        className="hidden sm:inline-flex"
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Heading 3"
        disabled={disabled}
      >
        <Heading3 size={14} />
      </Btn>

      <Divider className="hidden sm:inline-block" />

      <Btn
        className="hidden sm:inline-flex"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
        disabled={disabled}
      >
        <List size={14} />
      </Btn>
      <Btn
        className="hidden sm:inline-flex"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
        disabled={disabled}
      >
        <ListOrdered size={14} />
      </Btn>
      <Btn
        className="hidden sm:inline-flex"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Blockquote"
        disabled={disabled}
      >
        <Quote size={14} />
      </Btn>

      <Divider className="hidden sm:inline-block" />

      <Btn
        className="hidden sm:inline-flex"
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Inline code"
        disabled={disabled}
      >
        <Code size={14} />
      </Btn>
      <Btn
        className="hidden sm:inline-flex"
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="Code block"
        disabled={disabled}
      >
        <Code2 size={14} />
      </Btn>

      <Divider className="hidden sm:inline-block" />

      <LinkButton editor={editor} disabled={disabled} />
      {editor.isActive('link') && (
        <Btn
          onClick={() => editor.chain().focus().unsetLink().run()}
          title="Remove link"
          disabled={disabled}
        >
          <Unlink size={14} />
        </Btn>
      )}

      <Btn
        onClick={() => editor.chain().focus().undo().run()}
        title="Undo (Ctrl/Cmd+Z)"
        disabled={disabled || !editor.can().undo()}
      >
        <Undo2 size={14} />
      </Btn>

      {/* Overflow — mobile-only. Pushes itself to the right edge of the
          row so the inline buttons still cluster on the left. */}
      <OverflowMenu editor={editor} disabled={disabled} className="sm:hidden ml-auto" />
    </div>
  );
}

/** Mobile overflow popover. Hand-rolled to stay consistent with
 *  LinkButton — this file deliberately avoids shadcn dropdowns so the
 *  toolbar doesn't drag in third-party chrome. */
function OverflowMenu({
  editor,
  disabled,
  className,
}: {
  editor: Editor;
  disabled: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // Close on outside click — same pattern as the LinkButton popover below.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-overflow-root]')) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Close the popover after a toolbar click — feels more like a phone
  // toolbar than a sticky panel.
  const act = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  return (
    <span className={cn('relative', className)} data-overflow-root>
      <Btn
        onClick={() => setOpen((v) => !v)}
        title="More formatting"
        disabled={disabled}
        active={open}
      >
        <MoreHorizontal size={14} />
      </Btn>
      {open && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-full right-0 mt-1 z-10 flex flex-wrap items-center gap-0.5 rounded-xl border border-border/70 bg-card p-1.5 shadow-lg w-[200px]"
        >
          <Btn
            active={editor.isActive('underline')}
            onClick={act(() => editor.chain().focus().toggleUnderline().run())}
            title="Underline"
            disabled={disabled}
          >
            <UnderlineIcon size={14} />
          </Btn>
          <Btn
            active={editor.isActive('strike')}
            onClick={act(() => editor.chain().focus().toggleStrike().run())}
            title="Strikethrough"
            disabled={disabled}
          >
            <Strikethrough size={14} />
          </Btn>
          <Btn
            active={editor.isActive('heading', { level: 1 })}
            onClick={act(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}
            title="Heading 1"
            disabled={disabled}
          >
            <Heading1 size={14} />
          </Btn>
          <Btn
            active={editor.isActive('heading', { level: 2 })}
            onClick={act(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}
            title="Heading 2"
            disabled={disabled}
          >
            <Heading2 size={14} />
          </Btn>
          <Btn
            active={editor.isActive('heading', { level: 3 })}
            onClick={act(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}
            title="Heading 3"
            disabled={disabled}
          >
            <Heading3 size={14} />
          </Btn>
          <Btn
            active={editor.isActive('bulletList')}
            onClick={act(() => editor.chain().focus().toggleBulletList().run())}
            title="Bullet list"
            disabled={disabled}
          >
            <List size={14} />
          </Btn>
          <Btn
            active={editor.isActive('orderedList')}
            onClick={act(() => editor.chain().focus().toggleOrderedList().run())}
            title="Numbered list"
            disabled={disabled}
          >
            <ListOrdered size={14} />
          </Btn>
          <Btn
            active={editor.isActive('blockquote')}
            onClick={act(() => editor.chain().focus().toggleBlockquote().run())}
            title="Blockquote"
            disabled={disabled}
          >
            <Quote size={14} />
          </Btn>
          <Btn
            active={editor.isActive('code')}
            onClick={act(() => editor.chain().focus().toggleCode().run())}
            title="Inline code"
            disabled={disabled}
          >
            <Code size={14} />
          </Btn>
          <Btn
            active={editor.isActive('codeBlock')}
            onClick={act(() => editor.chain().focus().toggleCodeBlock().run())}
            title="Code block"
            disabled={disabled}
          >
            <Code2 size={14} />
          </Btn>
        </div>
      )}
    </span>
  );
}

function Btn({
  active,
  onClick,
  title,
  children,
  disabled,
  className,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
  /** Optional class — used to hide non-essential buttons on mobile. */
  className?: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Prevent the toolbar from stealing the editor's selection.
        e.preventDefault();
        if (!disabled) onClick();
      }}
      title={title}
      disabled={disabled}
      aria-pressed={active ?? false}
      className={cn(
        'p-1.5 rounded-md transition-colors duration-150',
        'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
        active && 'bg-foreground/[0.06] text-foreground',
        disabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {children}
    </button>
  );
}

function Divider({ className }: { className?: string }) {
  return <span className={cn('w-px h-5 bg-border/60 mx-1', className)} aria-hidden />;
}

function LinkButton({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');

  const onOpen = useCallback(() => {
    const existing = (editor.getAttributes('link') as { href?: string }).href ?? '';
    setUrl(existing);
    setOpen(true);
  }, [editor]);

  const onApply = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().unsetLink().run();
    } else {
      // Normalize to a valid URL — autoinsert https:// if the user just
      // pasted "example.com".
      const normalized = /^(https?:|mailto:|tel:)/i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: normalized })
        .run();
    }
    setOpen(false);
  }, [editor, url]);

  return (
    <span className="relative">
      <Btn
        active={editor.isActive('link')}
        onClick={onOpen}
        title="Insert link"
        disabled={disabled}
      >
        <LinkIcon size={14} />
      </Btn>
      {open && (
        <div
          // Inline popover — kept simple so it doesn't pull a Radix
          // dropdown into this client bundle. Matches the muted card
          // pattern from the stylesheet.
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-full left-0 mt-1 z-10 flex items-center gap-1 rounded-xl border border-border/70 bg-card p-2 shadow-lg"
        >
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onApply();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              }
            }}
            placeholder="https://…"
            autoFocus
            className="h-9 w-64 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground/70 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onApply();
            }}
            className="inline-flex items-center rounded-full bg-foreground px-3 h-9 text-[13px] font-semibold text-background hover:opacity-90"
          >
            Apply
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(false);
            }}
            className="inline-flex items-center rounded-full px-3 h-9 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}
    </span>
  );
}

export default TiptapEditor;
