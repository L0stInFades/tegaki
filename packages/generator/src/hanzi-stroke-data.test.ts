import { describe, expect, test } from 'bun:test';
import { SIMPLIFIED_CHINESE_CHARS } from './charsets.ts';
import {
  fetchHanziWriterData,
  type HanziWriterCharData,
  hanziDataToCompactGlyph,
  hanziMediansToStrokes,
  isCjkIdeograph,
  mmahToFontUnits,
} from './hanzi-stroke-data.ts';

/** Fixture medians for 中 (4 strokes) — subset of real hanzi-writer-data. */
const ZHONG: HanziWriterCharData = {
  medians: [
    [
      [194, 598],
      [229, 572],
      [236, 553],
      [254, 400],
      [282, 324],
    ],
    [
      [254, 596],
      [476, 628],
      [717, 668],
      [762, 666],
      [752, 425],
    ],
    [
      [306, 381],
      [475, 399],
      [693, 435],
    ],
    [
      [530, 370],
      [528, 200],
      [520, 50],
    ],
  ],
};

describe('isCjkIdeograph', () => {
  test('detects common Simplified Chinese characters', () => {
    for (const ch of ['中', '国', '人', '一', '永']) {
      expect(isCjkIdeograph(ch)).toBe(true);
    }
  });

  test('rejects Latin and punctuation', () => {
    expect(isCjkIdeograph('A')).toBe(false);
    expect(isCjkIdeograph('1')).toBe(false);
    expect(isCjkIdeograph('，')).toBe(false);
  });
});

describe('mmahToFontUnits', () => {
  test('maps baseline Y to font y ≈ 0', () => {
    const p = mmahToFontUnits(512, 800, { unitsPerEm: 1000, canvasSize: 1024, baselineY: 800 });
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.x).toBeCloseTo(500, 0);
  });
});

describe('hanziMediansToStrokes / hanziDataToCompactGlyph (issue #52)', () => {
  test('produces one stroke per median with increasing delays (stroke order)', () => {
    const strokes = hanziMediansToStrokes(ZHONG.medians, { drawingSpeed: 1000, strokePause: 0.05 });
    expect(strokes.length).toBe(4);
    for (let i = 0; i < strokes.length; i++) {
      expect(strokes[i]!.order).toBe(i);
      expect(strokes[i]!.points.length).toBeGreaterThanOrEqual(2);
      expect(strokes[i]!.animationDuration).toBeGreaterThan(0);
      if (i > 0) {
        expect(strokes[i]!.delay).toBeGreaterThan(strokes[i - 1]!.delay);
      }
    }
  });

  test('compact glyph is non-empty and suitable for the renderer', () => {
    const glyph = hanziDataToCompactGlyph(ZHONG, 1000, { unitsPerEm: 1000 });
    expect(glyph.w).toBe(1000);
    expect(glyph.t).toBeGreaterThan(0);
    expect(glyph.s.length).toBe(4);
    for (const s of glyph.s) {
      expect(s.p.length).toBeGreaterThanOrEqual(2);
      expect(s.a).toBeGreaterThan(0);
      // points are [x,y,width]
      expect(s.p[0]).toHaveLength(3);
    }
  });

  test('empty medians yield empty stroke list', () => {
    expect(hanziMediansToStrokes([])).toEqual([]);
    const g = hanziDataToCompactGlyph({ medians: [] }, 500);
    expect(g.s).toEqual([]);
    expect(g.t).toBe(0);
  });
});

describe('SIMPLIFIED_CHINESE_CHARS charset', () => {
  test('includes representative Han, Chinese punctuation, and Latin baseline', () => {
    expect(SIMPLIFIED_CHINESE_CHARS.length).toBeGreaterThan(100);
    for (const ch of ['中', '国', '人', '一', '永', '，', '。', 'A', '0']) {
      expect(SIMPLIFIED_CHINESE_CHARS.includes(ch), `missing ${ch}`).toBe(true);
    }
  });

  test('stays under Google Fonts subset cliff (~670 CJK-sized units)', () => {
    // Korean docs: cliff ≈ 670 Hangul; Chinese codepoints encode longer, so
    // keep unique count modest for the preset. Full 3500 is intentionally out
    // of the default preset (see issue-52-limits).
    const unique = new Set([...SIMPLIFIED_CHINESE_CHARS]);
    expect(unique.size).toBeLessThan(600);
    expect(unique.size).toBeGreaterThan(150);
  });
});

describe('fetchHanziWriterData (live CDN)', () => {
  test('loads 中 from hanzi-writer-data and converts to drawable strokes', async () => {
    const data = await fetchHanziWriterData('中');
    expect(data).not.toBeNull();
    expect(data!.medians.length).toBeGreaterThanOrEqual(3);
    const glyph = hanziDataToCompactGlyph(data!, 1000);
    expect(glyph.s.length).toBe(data!.medians.length);
    expect(glyph.t).toBeGreaterThan(0);
  }, 30_000);
});
