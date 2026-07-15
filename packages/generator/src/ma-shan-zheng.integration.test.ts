/**
 * Integration: Ma Shan Zheng + Simplified Chinese path (issue #52).
 * Downloads the font for a representative subset and runs the real pipeline.
 */
import { describe, expect, test } from 'bun:test';
import { SIMPLIFIED_CHINESE_CHARS } from './charsets.ts';
import { DEFAULT_OPTIONS, parseFont, processGlyph } from './commands/generate.ts';
import { downloadFont } from './font/download.ts';
import { fetchHanziWriterData, hanziDataToCompactGlyph, isCjkIdeograph } from './hanzi-stroke-data.ts';

const SAMPLE = '中国人永一';

describe('Ma Shan Zheng Simplified Chinese pipeline (issue #52)', () => {
  test('downloads Ma Shan Zheng and processGlyph returns stroke data for sample Han', async () => {
    const paths = await downloadFont('Ma Shan Zheng', { chars: `${SAMPLE}Aa` });
    expect(paths.length).toBeGreaterThanOrEqual(1);
    const buffers = await Promise.all(paths.map(async (p) => Bun.file(p).arrayBuffer()));
    const fontInfo = await parseFont(buffers[0]!, buffers.slice(1));

    for (const ch of [...SAMPLE]) {
      const result = processGlyph(fontInfo, ch, { ...DEFAULT_OPTIONS, resolution: 160 });
      expect(result, `glyph ${ch}`).not.toBeNull();
      expect(result!.strokesFontUnits.length).toBeGreaterThanOrEqual(1);
      expect(result!.strokesFontUnits[0]!.points.length).toBeGreaterThanOrEqual(1);
      expect(result!.advanceWidth).toBeGreaterThan(0);
    }
  }, 180_000);

  test('hanzi-writer medians produce compact glyph for each sample character', async () => {
    for (const ch of [...SAMPLE]) {
      expect(isCjkIdeograph(ch)).toBe(true);
      const data = await fetchHanziWriterData(ch);
      expect(data, `hanzi data for ${ch}`).not.toBeNull();
      const glyph = hanziDataToCompactGlyph(data!, 1000);
      expect(glyph.s.length).toBeGreaterThanOrEqual(1);
      expect(glyph.t).toBeGreaterThan(0);
    }
  }, 60_000);

  test('SIMPLIFIED_CHINESE_CHARS is the preset used for Ma Shan Zheng bundles', () => {
    for (const ch of [...SAMPLE]) {
      expect(SIMPLIFIED_CHINESE_CHARS.includes(ch)).toBe(true);
    }
  });
});
