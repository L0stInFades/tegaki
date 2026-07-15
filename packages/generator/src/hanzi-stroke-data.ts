/**
 * Hanzi Writer / Make Me a Hanzi stroke data integration (issue #52).
 *
 * Converts official stroke-order medians into tegaki-compatible timed strokes
 * so CJK glyphs can skip the rasterize → skeletonize → trace pipeline while
 * still producing animation-ready geometry.
 *
 * Coordinate system (Make Me a Hanzi): roughly 1024×1024, origin bottom-left,
 * y-up. We map into font units (y-up, baseline ≈ 0) using `unitsPerEm`.
 */

import type { Point, Stroke, TimedPoint } from 'tegaki';

/** Subset of the hanzi-writer-data JSON shape we consume. */
export interface HanziWriterCharData {
  /** SVG path strings per stroke (outline). Unused for skeleton animation. */
  strokes?: string[];
  /** Per-stroke centerline polylines as `[x, y][]` in MMAH coordinates. */
  medians: number[][][];
  radStrokes?: number[];
}

export interface HanziToStrokesOptions {
  /** Target font units-per-em. Default 1000. */
  unitsPerEm?: number;
  /** MMAH canvas size. Default 1024. */
  canvasSize?: number;
  /**
   * Y of the approximate baseline in MMAH coords (points with this y map to
   * font y = 0). Default 800 — matches the common Make Me a Hanzi layout.
   */
  baselineY?: number;
  /** Constant stroke diameter in font units. Default 40. */
  strokeWidth?: number;
  /** Drawing speed (font units / second) for timing. Default 800. */
  drawingSpeed?: number;
  /** Pause between strokes (seconds). Default 0.05. */
  strokePause?: number;
}

const DEFAULTS = {
  unitsPerEm: 1000,
  canvasSize: 1024,
  baselineY: 800,
  strokeWidth: 40,
  drawingSpeed: 800,
  strokePause: 0.05,
} as const;

/** True for CJK Unified Ideographs (basic + common extensions used in SC). */
export function isCjkIdeograph(char: string): boolean {
  const cp = char.codePointAt(0);
  if (cp == null) return false;
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
    (cp >= 0x3400 && cp <= 0x4dbf) || // Ext A
    (cp >= 0x20000 && cp <= 0x2a6df) // Ext B
  );
}

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1]!, points[i]!);
  return len;
}

/** Map a single MMAH point into font units (y-up, baseline 0). */
export function mmahToFontUnits(
  x: number,
  y: number,
  opts: Pick<HanziToStrokesOptions, 'unitsPerEm' | 'canvasSize' | 'baselineY'> = {},
): Point {
  const unitsPerEm = opts.unitsPerEm ?? DEFAULTS.unitsPerEm;
  const canvasSize = opts.canvasSize ?? DEFAULTS.canvasSize;
  const baselineY = opts.baselineY ?? DEFAULTS.baselineY;
  const scale = unitsPerEm / canvasSize;
  return {
    x: x * scale,
    y: (y - baselineY) * scale,
  };
}

/**
 * Convert hanzi-writer medians into ordered tegaki strokes with timing.
 * Returns empty array when medians are missing/empty.
 */
export function hanziMediansToStrokes(medians: number[][][], options: HanziToStrokesOptions = {}): Stroke[] {
  const strokeWidth = options.strokeWidth ?? DEFAULTS.strokeWidth;
  const drawingSpeed = options.drawingSpeed ?? DEFAULTS.drawingSpeed;
  const strokePause = options.strokePause ?? DEFAULTS.strokePause;
  const mapOpts = {
    unitsPerEm: options.unitsPerEm,
    canvasSize: options.canvasSize,
    baselineY: options.baselineY,
  };

  const strokes: Stroke[] = [];
  let timeOffset = 0;

  for (let order = 0; order < medians.length; order++) {
    const raw = medians[order]!;
    if (!raw || raw.length === 0) continue;

    const pointsXY: Point[] = raw.map((p) => mmahToFontUnits(p[0]!, p[1]!, mapOpts));
    const totalLen = pathLength(pointsXY);
    let cum = 0;
    const points: TimedPoint[] = pointsXY.map((p, i) => {
      if (i > 0) cum += dist(pointsXY[i - 1]!, p);
      const t = totalLen > 0 ? cum / totalLen : 0;
      return { x: p.x, y: p.y, t, width: strokeWidth };
    });

    const animationDuration = Math.max(totalLen / drawingSpeed, 0.001);
    strokes.push({
      points,
      order,
      length: totalLen,
      animationDuration,
      delay: timeOffset,
    });
    timeOffset += animationDuration + (order < medians.length - 1 ? strokePause : 0);
  }

  return strokes;
}

/** Compact glyph shape matching generator `toCompactGlyph` output. */
export interface CompactHanziGlyph {
  w: number;
  t: number;
  s: { p: [number, number, number][]; d: number; a: number }[];
}

/**
 * Build a compact tegaki glyph from hanzi-writer data + advance width.
 * This is the library-level entry used by the generate pipeline and tests.
 */
export function hanziDataToCompactGlyph(
  data: HanziWriterCharData,
  advanceWidth: number,
  options: HanziToStrokesOptions = {},
): CompactHanziGlyph {
  const strokes = hanziMediansToStrokes(data.medians, options);
  const last = strokes[strokes.length - 1];
  const t = last ? Math.round((last.delay + last.animationDuration) * 1000) / 1000 : 0;
  return {
    w: advanceWidth,
    t,
    s: strokes.map((s) => ({
      p: s.points.map((p) => [round2(p.x), round2(p.y), round2(p.width)] as [number, number, number]),
      d: round3(s.delay),
      a: round3(s.animationDuration),
    })),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Fetch a single character from the public hanzi-writer-data CDN.
 * Returns null when the character is not in the dataset (network/404).
 */
export async function fetchHanziWriterData(
  char: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<HanziWriterCharData | null> {
  if (!isCjkIdeograph(char)) return null;
  const base = opts.baseUrl ?? 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1';
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${base}/${encodeURIComponent(char)}.json`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const data = (await res.json()) as HanziWriterCharData;
    if (!data?.medians || !Array.isArray(data.medians) || data.medians.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}
