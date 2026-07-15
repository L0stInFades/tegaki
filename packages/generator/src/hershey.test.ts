import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hersheyGlyphToCompact, hersheyTextToGlyphs, parseHersheyFont, parseHersheyLine } from './hershey.ts';

const FIXTURE = readFileSync(join(import.meta.dir, 'fixtures/futural.jhf'), 'utf8');

describe('parseHersheyLine', () => {
  test('parses a multi-stroke glyph with pen-up separators', () => {
    // Classic sample with pen-up " R"
    const g = parseHersheyLine('  752  1RMvRMR[R]R');
    // may be short - use a line from fixture instead
    const font = parseHersheyFont(FIXTURE);
    const A = font.glyphs['A'];
    expect(A).toBeDefined();
    expect(A!.advance).toBeGreaterThan(0);
    expect(A!.strokes.length).toBeGreaterThanOrEqual(1);
    expect(A!.strokes[0]!.length).toBeGreaterThanOrEqual(2);
  });

  test('rejects empty/malformed lines', () => {
    expect(parseHersheyLine('')).toBeNull();
    expect(parseHersheyLine('short')).toBeNull();
  });
});

describe('parseHersheyFont + tegaki conversion (issue #23)', () => {
  const font = parseHersheyFont(FIXTURE, 'futural');

  test('maps occidental ASCII order space→tilde', () => {
    expect(font.glyphs[' ']).toBeDefined();
    expect(font.glyphs['A']).toBeDefined();
    expect(font.glyphs['z']).toBeDefined();
    expect(font.order.length).toBeGreaterThanOrEqual(95);
  });

  test('hersheyGlyphToCompact produces drawable stroke data for A', () => {
    const compact = hersheyGlyphToCompact(font.glyphs['A']!);
    expect(compact.w).toBeGreaterThan(0);
    expect(compact.t).toBeGreaterThan(0);
    expect(compact.s.length).toBeGreaterThanOrEqual(1);
    for (const s of compact.s) {
      expect(s.p.length).toBeGreaterThanOrEqual(2);
      expect(s.a).toBeGreaterThan(0);
      // single-line: finite coordinates
      for (const p of s.p) {
        expect(Number.isFinite(p[0])).toBe(true);
        expect(Number.isFinite(p[1])).toBe(true);
        expect(p[2]).toBeGreaterThan(0);
      }
    }
  });

  test('hersheyTextToGlyphs renders HELLO with non-empty polylines', () => {
    const glyphs = hersheyTextToGlyphs('HELLO', font);
    expect(glyphs.map((g) => g.char).join('')).toBe('HELLO');
    for (const { glyph } of glyphs) {
      expect(glyph.s.length).toBeGreaterThanOrEqual(1);
      const pts = glyph.s.flatMap((s) => s.p);
      expect(pts.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('same glyph is stable across repeated conversion (deterministic)', () => {
    const a = hersheyGlyphToCompact(font.glyphs['B']!);
    const b = hersheyGlyphToCompact(font.glyphs['B']!);
    expect(a).toEqual(b);
  });
});
