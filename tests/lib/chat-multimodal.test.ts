/**
 * Tests for the Phase 4 multimodal builder.
 *
 * The builder is pure (no I/O) — coverage is shape verification per provider
 * plus the unsupported-attachment fallback note generator.
 */

import { describe, it, expect } from 'vitest';
import {
  buildMultimodalContent,
  isImageMime,
  isPdfMime,
  providerSupportsImages,
  providerSupportsPdfs,
} from '@/lib/chat/multimodal';

const IMG = {
  id: 'a1',
  filename: 'shot.png',
  mimeType: 'image/png',
  url: 'https://example.com/shot.png',
};
const JPG = {
  id: 'a2',
  filename: 'mls.jpg',
  mimeType: 'image/jpeg',
  url: 'https://example.com/mls.jpg',
};
const PDF = {
  id: 'a3',
  filename: 'contract.pdf',
  mimeType: 'application/pdf',
  url: 'https://example.com/contract.pdf',
};

describe('isImageMime / isPdfMime', () => {
  it('recognizes the supported image types', () => {
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('image/webp')).toBe(true);
    expect(isImageMime('image/gif')).toBe(true);
    expect(isImageMime('image/heic')).toBe(false);
    expect(isImageMime('IMAGE/PNG')).toBe(true);
  });
  it('recognizes pdf', () => {
    expect(isPdfMime('application/pdf')).toBe(true);
    expect(isPdfMime('APPLICATION/PDF')).toBe(true);
    expect(isPdfMime('text/pdf')).toBe(false);
  });
});

describe('providerSupports*', () => {
  it('reports image support per provider', () => {
    expect(providerSupportsImages('anthropic')).toBe(true);
    expect(providerSupportsImages('openai')).toBe(true);
    expect(providerSupportsImages('google')).toBe(true);
    expect(providerSupportsImages('xai')).toBe(false);
    expect(providerSupportsImages('moonshotai')).toBe(false);
  });
  it('reports pdf support per provider', () => {
    expect(providerSupportsPdfs('anthropic')).toBe(true);
    expect(providerSupportsPdfs('openai')).toBe(false);
    expect(providerSupportsPdfs('google')).toBe(false);
    expect(providerSupportsPdfs('xai')).toBe(false);
  });
});

describe('buildMultimodalContent — anthropic', () => {
  it('encodes images as Anthropic image blocks with source.url', () => {
    const r = buildMultimodalContent('anthropic/claude-opus-4.7', 'Tell me about this.', [IMG, JPG]);
    expect(r.unsupported).toEqual([]);
    expect(r.fallbackNote).toBe('');
    expect(r.blocks[0]).toEqual({ type: 'text', text: 'Tell me about this.' });
    expect(r.blocks[1]).toEqual({
      type: 'image',
      source: { type: 'url', url: IMG.url, media_type: 'image/png' },
    });
    expect(r.blocks[2]).toEqual({
      type: 'image',
      source: { type: 'url', url: JPG.url, media_type: 'image/jpeg' },
    });
  });

  it('encodes PDFs as Anthropic document blocks', () => {
    const r = buildMultimodalContent('anthropic/claude-opus-4.7', 'Summarize this contract.', [PDF]);
    expect(r.unsupported).toEqual([]);
    expect(r.blocks[1]).toEqual({
      type: 'document',
      source: { type: 'url', url: PDF.url, media_type: 'application/pdf' },
    });
  });
});

describe('buildMultimodalContent — openai', () => {
  it('encodes images as image_url blocks', () => {
    const r = buildMultimodalContent('openai/gpt-5.5', 'What is this?', [IMG]);
    expect(r.blocks[0]).toEqual({ type: 'text', text: 'What is this?' });
    expect(r.blocks[1]).toEqual({ type: 'image_url', image_url: { url: IMG.url } });
  });

  it('drops PDFs and emits a fallback note (openai has no native PDF in this path)', () => {
    const r = buildMultimodalContent('openai/gpt-5.5', 'Read this contract.', [PDF]);
    expect(r.unsupported).toEqual([PDF]);
    expect(r.fallbackNote).toMatch(/Claude/i);
    expect(r.blocks.find((b) => b.type === 'document')).toBeUndefined();
  });
});

describe('buildMultimodalContent — google (gemini)', () => {
  it('encodes images via image_url shape (OpenAI-compatible)', () => {
    const r = buildMultimodalContent('google/gemini-2.5-pro', 'Take a look.', [IMG]);
    expect(r.blocks[1]).toEqual({ type: 'image_url', image_url: { url: IMG.url } });
  });
  it('does not support PDFs through OpenRouter, falls back', () => {
    const r = buildMultimodalContent('google/gemini-2.5-pro', 'Read this.', [PDF]);
    expect(r.unsupported).toEqual([PDF]);
    expect(r.fallbackNote).toMatch(/Claude/i);
  });
});

describe('buildMultimodalContent — xai (Grok)', () => {
  it('drops images with a Grok-specific calm fallback note', () => {
    const r = buildMultimodalContent('x-ai/grok-4.3', 'Look at this listing.', [IMG]);
    expect(r.unsupported).toEqual([IMG]);
    expect(r.fallbackNote).toMatch(/Grok can't see/i);
    expect(r.fallbackNote).toMatch(/Claude.*GPT-5/i);
  });

  it('drops PDFs with a Grok-specific calm fallback note', () => {
    const r = buildMultimodalContent('x-ai/grok-4.3', 'Read this.', [PDF]);
    expect(r.unsupported).toEqual([PDF]);
    expect(r.fallbackNote).toMatch(/Grok/i);
  });

  it('handles mixed attachments — both unsupported — with one combined note', () => {
    const r = buildMultimodalContent('x-ai/grok-4.3', 'What do you see?', [IMG, PDF]);
    expect(r.unsupported).toEqual([IMG, PDF]);
    expect(r.fallbackNote).toMatch(/Grok/i);
    expect(r.fallbackNote).toMatch(/images.*PDFs|PDFs.*images/i);
  });
});

describe('buildMultimodalContent — text-only / edge cases', () => {
  it('returns just a text block when no attachments', () => {
    const r = buildMultimodalContent('anthropic/claude-opus-4.7', 'Hi.', []);
    expect(r.blocks).toEqual([{ type: 'text', text: 'Hi.' }]);
    expect(r.unsupported).toEqual([]);
  });

  it('synthesises a leading text block when none provided but attachments present', () => {
    const r = buildMultimodalContent('anthropic/claude-opus-4.7', '', [IMG]);
    expect(r.blocks[0].type).toBe('text');
    expect((r.blocks[0] as { text: string }).text).toMatch(/Take a look/i);
  });

  it('drops attachments with missing URLs', () => {
    const noUrl = { ...IMG, url: '' };
    const r = buildMultimodalContent('anthropic/claude-opus-4.7', 'See this.', [noUrl]);
    expect(r.unsupported).toEqual([noUrl]);
    expect(r.blocks.some((b) => b.type === 'image' || b.type === 'image_url')).toBe(false);
  });

  it('drops unsupported mimes (e.g. docx)', () => {
    const docx = {
      id: 'a4',
      filename: 'a.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      url: 'https://example.com/a.docx',
    };
    const r = buildMultimodalContent('anthropic/claude-opus-4.7', 'Read this.', [docx]);
    expect(r.unsupported).toEqual([docx]);
  });
});
