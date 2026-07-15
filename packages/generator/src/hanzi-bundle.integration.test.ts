/**
 * Proves the shipped extractTegakiBundle path with useHanziStrokeData produces
 * official hanzi-writer stroke counts for SC ideographs (issue #52).
 */
import { describe, expect, test } from 'bun:test';
import { DEFAULT_OPTIONS, extractTegakiBundle } from './commands/generate.ts';
import { downloadFont } from './font/download.ts';
import { fetchHanziWriterData } from './hanzi-stroke-data.ts';

describe('extractTegakiBundle useHanziStrokeData (issue #52 shipped path)', () => {
  test('中 uses hanzi-writer median count (4), not skeleton stroke count', async () => {
    const chars = '中Aa';
    const paths = await downloadFont('Ma Shan Zheng', { chars });
    const buffers = await Promise.all(paths.map((p) => Bun.file(p).arrayBuffer()));
    const fullPaths = await downloadFont('Ma Shan Zheng');
    const fullBuf = await Bun.file(fullPaths[0]!).arrayBuffer();

    const withHanzi = await extractTegakiBundle({
      fontBuffer: buffers[0]!,
      fontFileName: 'ma-shan-zheng.ttf',
      chars,
      options: { ...DEFAULT_OPTIONS, resolution: 160 },
      extraFontBuffers: buffers.slice(1),
      requestedFamily: 'Ma Shan Zheng',
      subset: true,
      fullFontBuffer: fullBuf,
      fullFontFileName: 'ma-shan-zheng-full.ttf',
      useHanziStrokeData: true,
    });

    const without = await extractTegakiBundle({
      fontBuffer: buffers[0]!,
      fontFileName: 'ma-shan-zheng.ttf',
      chars,
      options: { ...DEFAULT_OPTIONS, resolution: 160 },
      extraFontBuffers: buffers.slice(1),
      requestedFamily: 'Ma Shan Zheng',
      subset: true,
      fullFontBuffer: fullBuf,
      fullFontFileName: 'ma-shan-zheng-full.ttf',
      useHanziStrokeData: false,
    });

    const hanziRef = await fetchHanziWriterData('中');
    expect(hanziRef).not.toBeNull();
    const expectedStrokes = hanziRef!.medians.length;
    expect(expectedStrokes).toBe(4);

    // glyphData.json content is written from files — parse the compact map from files
    const glyphFile = withHanzi.files.find((f) => f.path === 'glyphData.json');
    expect(glyphFile).toBeDefined();
    const glyphData = JSON.parse(glyphFile!.content as string) as Record<string, { s: unknown[] }>;
    expect(glyphData.中?.s.length).toBe(expectedStrokes);

    const glyphFileOff = without.files.find((f) => f.path === 'glyphData.json');
    const glyphDataOff = JSON.parse(glyphFileOff!.content as string) as Record<string, { s: unknown[] }>;
    // Skeleton path typically differs from official stroke count
    expect(glyphDataOff.中?.s.length).not.toBe(expectedStrokes);

    // No diacritic priority on hanzi-sourced strokes
    const raw = glyphData.中!.s as { r?: number }[];
    expect(raw.every((s) => s.r === undefined || s.r >= 0)).toBe(true);
  }, 180_000);
});
