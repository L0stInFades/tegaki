/**
 * Hershey single-line font loader/parser (issue #23).
 *
 * Parses classic `.jhf` (James Hurt format) glyph lines into stroke polylines
 * suitable for tegaki's compact glyph representation. Single-line fonts have
 * zero fill width by construction — ideal for CNC / pen-plotter effects.
 *
 * Coordinate convention: Hershey stores y-up integer pairs relative to 'R'
 * (ASCII 82 = 0). We keep that y-up system and scale into optional font units.
 *
 * Reference: http://paulbourke.net/dataformats/hershey/
 */

import type { Point, Stroke, TimedPoint } from 'tegaki';

export interface HersheyGlyph {
  /** Hershey glyph id from the file (when present). */
  id: number;
  /** Left bearing (Hershey units). */
  left: number;
  /** Right bearing (Hershey units). */
  right: number;
  /** Advance width = right - left. */
  advance: number;
  /** Pen strokes as polylines in Hershey coordinates (y-up). */
  strokes: Point[][];
}

export interface HersheyFont {
  /** Optional display name. */
  name?: string;
  /**
   * Glyphs keyed by ASCII code when the file is a 96-glyph occidental set
   * ordered space…tilde, otherwise by sequential index as a string.
   */
  glyphs: Record<string, HersheyGlyph>;
  /** Ordered glyph list matching file order. */
  order: HersheyGlyph[];
}

export interface HersheyToTegakiOptions {
  /** Scale Hershey units → font units. Default 20 (Hershey ~[-20,20] → em-ish). */
  scale?: number;
  /** Y flip after scale so tegaki font y (baseline 0, up positive) matches. Default true keeps y-up. */
  /** Constant stroke diameter in font units. Default 30. */
  strokeWidth?: number;
  drawingSpeed?: number;
  strokePause?: number;
}

const R = 'R'.charCodeAt(0); // 82

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pathLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1]!, pts[i]!);
  return len;
}

/**
 * Parse one `.jhf` glyph line into a {@link HersheyGlyph}.
 * Returns null for blank/malformed lines.
 */
export function parseHersheyLine(line: string): HersheyGlyph | null {
  if (!line?.trim()) return null;
  // Format: IIIIIVVV + pairs…  (id 5 chars, vertex count 3 chars, then data)
  if (line.length < 8) return null;
  const id = Number.parseInt(line.slice(0, 5), 10);
  const nVerts = Number.parseInt(line.slice(5, 8), 10);
  if (!Number.isFinite(id) || !Number.isFinite(nVerts) || nVerts < 1) return null;

  const data = line.slice(8);
  // Each vertex is 2 characters; first pair is L/R bounds.
  if (data.length < 2) return null;

  const left = data.charCodeAt(0) - R;
  const right = data.charCodeAt(1) - R;

  const strokes: Point[][] = [];
  let current: Point[] = [];

  // Remaining pairs are vertices; " R" (space + R) is pen-up.
  for (let i = 2; i + 1 < data.length && (i - 2) / 2 < nVerts - 1; i += 2) {
    const c1 = data[i]!;
    const c2 = data[i + 1]!;
    if (c1 === ' ' && c2 === 'R') {
      if (current.length > 0) {
        strokes.push(current);
        current = [];
      }
      continue;
    }
    const x = c1.charCodeAt(0) - R;
    const y = c2.charCodeAt(0) - R;
    current.push({ x, y });
  }
  if (current.length > 0) strokes.push(current);

  return {
    id: Number.isFinite(id) ? id : 0,
    left,
    right,
    advance: right - left,
    strokes,
  };
}

/**
 * Parse a full `.jhf` file body. When the file has ~95–96 glyphs it is treated
 * as an occidental ASCII set ordered from space (32) through `~` (126).
 */
export function parseHersheyFont(jhfText: string, name?: string): HersheyFont {
  const order: HersheyGlyph[] = [];
  for (const raw of jhfText.split(/\r?\n/)) {
    const g = parseHersheyLine(raw);
    if (g) order.push(g);
  }

  const glyphs: Record<string, HersheyGlyph> = {};
  const asciiSet = order.length >= 95 && order.length <= 96;
  for (let i = 0; i < order.length; i++) {
    const key = asciiSet ? String.fromCharCode(32 + i) : String(i);
    glyphs[key] = order[i]!;
  }

  return { name, glyphs, order };
}

/**
 * Convert a Hershey glyph into tegaki strokes with animation timing.
 * Translates so left bearing sits at x=0 and scales into font units.
 */
export function hersheyGlyphToStrokes(glyph: HersheyGlyph, options: HersheyToTegakiOptions = {}): Stroke[] {
  const scale = options.scale ?? 20;
  const strokeWidth = options.strokeWidth ?? 30;
  const drawingSpeed = options.drawingSpeed ?? 800;
  const strokePause = options.strokePause ?? 0.05;

  const strokes: Stroke[] = [];
  let timeOffset = 0;

  for (let order = 0; order < glyph.strokes.length; order++) {
    const raw = glyph.strokes[order]!;
    if (raw.length === 0) continue;
    // Shift by -left so the glyph starts at x≈0, scale into font units.
    const pointsXY: Point[] = raw.map((p) => ({
      x: (p.x - glyph.left) * scale,
      y: p.y * scale,
    }));
    const totalLen = pathLength(pointsXY);
    let cum = 0;
    const points: TimedPoint[] = pointsXY.map((p, i) => {
      if (i > 0) cum += dist(pointsXY[i - 1]!, p);
      return {
        x: p.x,
        y: p.y,
        t: totalLen > 0 ? cum / totalLen : 0,
        width: strokeWidth,
      };
    });
    const animationDuration = Math.max(totalLen / drawingSpeed, 0.001);
    strokes.push({
      points,
      order,
      length: totalLen,
      animationDuration,
      delay: timeOffset,
    });
    timeOffset += animationDuration + (order < glyph.strokes.length - 1 ? strokePause : 0);
  }

  return strokes;
}

/** Compact tegaki glyph produced from a Hershey glyph. */
export interface CompactHersheyGlyph {
  w: number;
  t: number;
  s: { p: [number, number, number][]; d: number; a: number }[];
}

export function hersheyGlyphToCompact(glyph: HersheyGlyph, options: HersheyToTegakiOptions = {}): CompactHersheyGlyph {
  const scale = options.scale ?? 20;
  const strokes = hersheyGlyphToStrokes(glyph, options);
  const last = strokes[strokes.length - 1];
  const t = last ? Math.round((last.delay + last.animationDuration) * 1000) / 1000 : 0;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    w: Math.max(1, Math.round(glyph.advance * scale)),
    t,
    s: strokes.map((s) => ({
      p: s.points.map((p) => [round2(p.x), round2(p.y), round2(p.width)] as [number, number, number]),
      d: round3(s.delay),
      a: round3(s.animationDuration),
    })),
  };
}

/**
 * Render a string of text into compact tegaki glyphs via a Hershey font.
 * Missing characters are skipped (caller may fall back).
 */
export function hersheyTextToGlyphs(
  text: string,
  font: HersheyFont,
  options: HersheyToTegakiOptions = {},
): { char: string; glyph: CompactHersheyGlyph }[] {
  const out: { char: string; glyph: CompactHersheyGlyph }[] = [];
  for (const char of text) {
    const g = font.glyphs[char];
    if (!g) continue;
    out.push({ char, glyph: hersheyGlyphToCompact(g, options) });
  }
  return out;
}
