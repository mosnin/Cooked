import { describe, expect, it } from 'vitest';
import {
  CHIPPI_BAR_MAX,
  CHIPPI_BAR_WIDTH_PX,
  CONTENT_COLUMN_PX,
  FOCUS_CARD_MAX,
  FOCUS_CARD_WIDTH_PX,
  PAGE_MAX,
  PAGE_MAX_PX,
  PAGE_PAD_LG_PX,
  PHI,
  RHYTHM_U,
  SIDEBAR_COLLAPSED,
  SIDEBAR_COLLAPSED_PX,
  SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_PX,
} from '@/lib/geometry';

/**
 * The Vitruvian macro frame derivation is the single source of truth for
 * every layout width above ~200px. This test locks the math so a future
 * "let me just tweak the sidebar to 256" can't slip through review and
 * silently break the rhythm or the golden inset.
 *
 * If a value here needs to change, the change is intentional — update the
 * STYLESHEET §Geometry section and this test in the same commit.
 */
describe('geometry — the Vitruvian macro frame', () => {
  describe('rhythm family — multiples of RHYTHM_U', () => {
    it('RHYTHM_U is the top of the harmonic spacing ladder', () => {
      expect(RHYTHM_U).toBe(48);
    });

    it('sidebar = RHYTHM_U × 5', () => {
      expect(SIDEBAR_WIDTH_PX).toBe(RHYTHM_U * 5);
    });

    it('chippi bar = RHYTHM_U × 16', () => {
      expect(CHIPPI_BAR_WIDTH_PX).toBe(RHYTHM_U * 16);
    });

    it('page padding (lg) = RHYTHM_U × 1', () => {
      expect(PAGE_PAD_LG_PX).toBe(RHYTHM_U);
    });

    it('collapsed sidebar is the named chrome exception (icon-rail convention)', () => {
      expect(SIDEBAR_COLLAPSED_PX).toBe(56);
      // Confirms it is NOT on the rhythm lattice — that's the whole point of
      // calling it an exception. If this ever becomes a clean multiple, fold
      // it back into the family and delete the exception note in geometry.ts.
      expect(SIDEBAR_COLLAPSED_PX % RHYTHM_U).not.toBe(0);
    });
  });

  describe('φ family — the FocusCard chain', () => {
    it('PHI is the golden ratio', () => {
      expect(PHI).toBeCloseTo(1.6180339887, 6);
    });

    it('page max is the design ceiling at 1500px', () => {
      expect(PAGE_MAX_PX).toBe(1500);
    });

    it('content column = page max − 2 × page padding', () => {
      expect(CONTENT_COLUMN_PX).toBe(PAGE_MAX_PX - 2 * PAGE_PAD_LG_PX);
      expect(CONTENT_COLUMN_PX).toBe(1404);
    });

    it('FocusCard = column / φ — the golden inset', () => {
      expect(FOCUS_CARD_WIDTH_PX).toBe(Math.round(CONTENT_COLUMN_PX / PHI));
      expect(FOCUS_CARD_WIDTH_PX).toBe(868);
    });

    it('column-to-card ratio is within 0.005 of φ (round to nearest px)', () => {
      // 1404 / 868 = 1.6175 vs PHI = 1.6180. The 0.0005 gap is the price
      // of rounding the card to a whole pixel; tighter than this would
      // demand fractional-pixel widths that don't render cleanly.
      expect(CONTENT_COLUMN_PX / FOCUS_CARD_WIDTH_PX).toBeCloseTo(PHI, 2);
    });
  });

  describe('Tailwind class string tokens', () => {
    it('embed the same px values as the numeric tokens', () => {
      expect(SIDEBAR_WIDTH).toBe(`w-[${SIDEBAR_WIDTH_PX}px]`);
      expect(SIDEBAR_COLLAPSED).toBe(`w-[${SIDEBAR_COLLAPSED_PX}px]`);
      expect(PAGE_MAX).toBe(`max-w-[${PAGE_MAX_PX}px]`);
      expect(FOCUS_CARD_MAX).toBe(`max-w-[${FOCUS_CARD_WIDTH_PX}px]`);
    });

    it('ChippiBar uses Tailwind`s max-w-3xl which equals 768px = CHIPPI_BAR_WIDTH_PX', () => {
      // Tailwind's `max-w-3xl` = 48rem = 768px at the default 16px root.
      // Kept as a class-string alias rather than `max-w-[768px]` for
      // semantic readability at the call site.
      expect(CHIPPI_BAR_MAX).toBe('max-w-3xl');
      expect(CHIPPI_BAR_WIDTH_PX).toBe(768);
    });
  });
});
