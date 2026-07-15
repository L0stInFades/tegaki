/**
 * Integration: real font pipeline on accented Latin glyphs (issue #27).
 * Downloads Caveat (cached), processes ô / é / ä / ù and asserts the accent stroke
 * is priority-tagged and ordered after the body.
 */
import { describe, expect, test } from 'bun:test';
import { DEFAULT_OPTIONS, parseFont, processGlyph } from '../commands/generate.ts';
import { downloadFont } from '../font/download.ts';

async function loadCaveat() {
  const paths = await downloadFont('Caveat', { chars: 'AaEeIiOoUuàâäéèêëíìîïóòôöúùûü' });
  const buf = await Bun.file(paths[0]!).arrayBuffer();
  return parseFont(buf);
}

describe('pipeline accent order (issue #27)', () => {
  test('precomposed Latin accents (ô, é) body stroke starts before accent mark', async () => {
    const fontInfo = await loadCaveat();
    for (const ch of ['ô', 'é', 'ä', 'ù'] as const) {
      const result = processGlyph(fontInfo, ch, { ...DEFAULT_OPTIONS, resolution: 200 });
      expect(result, `expected glyph data for ${ch}`).not.toBeNull();
      const strokes = result!.strokesFontUnits;
      expect(strokes.length).toBeGreaterThanOrEqual(2);

      const body = strokes.filter((s) => (s.priority ?? 0) >= 0);
      const marks = strokes.filter((s) => (s.priority ?? 0) < 0);
      expect(marks.length, `${ch}: expected at least one deferred diacritic`).toBeGreaterThanOrEqual(1);
      expect(body.length, `${ch}: expected at least one body stroke`).toBeGreaterThanOrEqual(1);

      const bodyEnd = Math.max(...body.map((s) => s.delay + s.animationDuration));
      const markStart = Math.min(...marks.map((s) => s.delay));
      expect(markStart, `${ch}: accent must not start before body finishes`).toBeGreaterThanOrEqual(bodyEnd - 1e-6);
    }
  }, 120_000);
});
