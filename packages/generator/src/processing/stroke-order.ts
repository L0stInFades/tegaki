// Stage 5 of the pipeline — see commands/generate.ts.
// Group polylines into connected components, decide draw order (top-to-bottom,
// left-to-right) and per-stroke direction, then assign each point a normalized
// time `t` ∈ [0, 1] for animation. Stroke widths are looked up from the
// inverse distance transform (or pre-supplied by the voronoi path).

import type { Point, Stroke, TimedPoint } from 'tegaki';
import { ORIENT_X_WEIGHT } from '../constants.ts';
import { getStrokeWidth } from './width.ts';

// Dot / diacritic classification thresholds (bitmap-space).
// A stroke is reclassified as a deferred mark (priority -1) when it is small
// relative to the glyph — by bbox diagonal *or* path length — and is either
// spatially isolated from every other stroke *or* sits clearly above/below the
// body formed by larger strokes. Isolation alone misses Latin circumflexes and
// Greek tonos marks that sit close to the letter top (issue #27); length-based
// smallness alone would over-flag short mid-glyph ticks in multi-stroke CJK.
const DOT_DIAG_RATIO = 0.28;
const DOT_LENGTH_RATIO = 0.28;
const DOT_ISOLATION_RATIO = 0.08;

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

/**
 * Orient a polyline so the "natural" starting point comes first.
 *
 * For near-closed loops (start ≈ end), rotates the chain to start from the
 * leftmost (LTR) or rightmost (RTL) point — the natural pen entry for the
 * script's writing direction.
 *
 * For open polylines, reverses if the end has a better (lower) orientation
 * score than the start. The x-weight flips sign for RTL so "preferred" means
 * rightmost instead of leftmost.
 */
function orientPolyline(points: Point[], rtl = false): Point[] {
  if (points.length < 2) return points;

  const start = points[0]!;
  const end = points[points.length - 1]!;
  const xWeight = rtl ? -ORIENT_X_WEIGHT : ORIENT_X_WEIGHT;

  // Near-closed loop: rotate to start from the leftmost (LTR) / rightmost (RTL) point
  if (dist(start, end) < 5) {
    // 2-point fragments (e.g. dots traced from a 2-pixel skeleton blob) aren't
    // real loops — the rotation formula would duplicate the extremum endpoint
    // into `[B, B]`, yielding a zero-length "stroke" that the renderer's
    // multi-point path drops. Collapse to a single-point dot instead.
    if (points.length === 2) return [start];
    let bestIdx = 0;
    let bestX = points[0]!.x;
    let bestY = points[0]!.y;
    for (let i = 1; i < points.length; i++) {
      const p = points[i]!;
      const better = rtl ? p.x > bestX || (p.x === bestX && p.y < bestY) : p.x < bestX || (p.x === bestX && p.y < bestY);
      if (better) {
        bestX = p.x;
        bestY = p.y;
        bestIdx = i;
      }
    }
    if (bestIdx !== 0) {
      return [...points.slice(bestIdx), ...points.slice(1, bestIdx + 1)];
    }
    return points;
  }

  // Open polyline: prefer starting from the script's "entry" side (top as tiebreaker)
  const startScore = start.y + start.x * xWeight;
  const endScore = end.y + end.x * xWeight;

  if (endScore < startScore) {
    return [...points].reverse();
  }
  return points;
}

/**
 * Process polylines into strokes, preserving the order from traceAndSimplify
 * which already implements proximity-based ordering (entry-side start,
 * closest-to-last-end sequencing). The entry side is middle-left for LTR and
 * middle-right for RTL scripts; see `traceAndSimplify` for the source.
 *
 * Each polyline is oriented for natural handwriting direction, then assigned
 * t parameter (animation progress) and stroke width values.
 */
export function orderStrokes(
  polylines: Point[][],
  inverseDT: Float32Array | null,
  bitmapWidth: number,
  _connectionThreshold = 3,
  precomputedWidths?: number[][],
  rtl = false,
): Stroke[] {
  if (polylines.length === 0) return [];

  const strokes: Stroke[] = [];

  for (let order = 0; order < polylines.length; order++) {
    const polyline = polylines[order]!;
    const oriented = orientPolyline(polyline, rtl);
    const totalLen = pathLength(oriented);

    // Look up precomputed widths by matching the original polyline reference
    const origIdx = precomputedWidths ? polylines.indexOf(polyline) : -1;
    const pWidths = origIdx >= 0 ? precomputedWidths![origIdx] : null;

    // Assign t parameter and width
    let cumLen = 0;
    const points: TimedPoint[] = oriented.map((p, i) => {
      if (i > 0) {
        cumLen += dist(oriented[i - 1]!, p);
      }
      const t = totalLen > 0 ? cumLen / totalLen : 0;
      // Precomputed widths use original point order; check if oriented is reversed
      const isReversed = oriented !== polyline && oriented[0] !== polyline[0];
      const widthIdx = isReversed ? oriented.length - 1 - i : i;
      const width = pWidths ? (pWidths[widthIdx] ?? 1) : inverseDT ? getStrokeWidth(p.x, p.y, inverseDT, bitmapWidth) : 1;
      return { x: p.x, y: p.y, t, width };
    });

    strokes.push({ points, order, length: totalLen, animationDuration: 0, delay: 0 });
  }

  // Single-point strokes (dots) get their width from the distance transform which
  // represents the blob's inscribed radius, not the pen width. Replace with the
  // average width of other strokes so dots match the visual weight of the glyph.
  const multiPointStrokes = strokes.filter((s) => s.points.length > 1);
  if (multiPointStrokes.length > 0) {
    const avgWidth =
      multiPointStrokes.reduce((sum, s) => sum + s.points.reduce((ps, p) => ps + p.width, 0) / s.points.length, 0) /
      multiPointStrokes.length;
    for (const s of strokes) {
      if (s.points.length === 1) {
        s.points[0]!.width = Math.round(avgWidth * 100) / 100;
      }
    }
  }

  classifyDots(strokes);
  reorderByPriority(strokes);

  return strokes;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function strokeBBox(s: Stroke): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of s.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function bboxDiag(b: BBox): number {
  const dx = b.maxX - b.minX;
  const dy = b.maxY - b.minY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Gap distance between two axis-aligned bboxes (in bitmap units). Zero when
 * they overlap or touch.
 */
function bboxGap(a: BBox, b: BBox): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Flag short disconnected marks as dots/diacritics (priority -1) so word-level
 * timeline scheduling can defer them until after every body stroke in the word
 * is drawn. Targets i-dots, Arabic nuqṭa, and Latin/Greek accents that sit
 * above or below the letter body — including marks that hug the body closely
 * enough that a pure isolation gap check would miss them (issue #27).
 */
function classifyDots(strokes: Stroke[]): void {
  if (strokes.length < 2) return; // a lone stroke is never a "dot to defer"
  const boxes = strokes.map(strokeBBox);
  let glyphMinX = Infinity;
  let glyphMinY = Infinity;
  let glyphMaxX = -Infinity;
  let glyphMaxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < glyphMinX) glyphMinX = b.minX;
    if (b.minY < glyphMinY) glyphMinY = b.minY;
    if (b.maxX > glyphMaxX) glyphMaxX = b.maxX;
    if (b.maxY > glyphMaxY) glyphMaxY = b.maxY;
  }
  const glyphDiag = Math.sqrt((glyphMaxX - glyphMinX) ** 2 + (glyphMaxY - glyphMinY) ** 2);
  if (glyphDiag <= 0) return;

  const maxLen = Math.max(...strokes.map((s) => s.length), 0);
  const maxDotDiag = glyphDiag * DOT_DIAG_RATIO;
  const isolationThreshold = glyphDiag * DOT_ISOLATION_RATIO;
  const maxDotLen = maxLen * DOT_LENGTH_RATIO;

  // Body candidates: strokes that are not small by either size metric. Used to
  // decide whether a small mark sits above/below the letter rather than inside it.
  const isBody = strokes.map((s, i) => bboxDiag(boxes[i]!) > maxDotDiag && s.length > maxDotLen);
  let bodyMinX = Infinity;
  let bodyMinY = Infinity;
  let bodyMaxX = -Infinity;
  let bodyMaxY = -Infinity;
  let hasBody = false;
  for (let i = 0; i < strokes.length; i++) {
    if (!isBody[i]) continue;
    hasBody = true;
    const b = boxes[i]!;
    if (b.minX < bodyMinX) bodyMinX = b.minX;
    if (b.minY < bodyMinY) bodyMinY = b.minY;
    if (b.maxX > bodyMaxX) bodyMaxX = b.maxX;
    if (b.maxY > bodyMaxY) bodyMaxY = b.maxY;
  }
  const bodyBox: BBox | null = hasBody ? { minX: bodyMinX, minY: bodyMinY, maxX: bodyMaxX, maxY: bodyMaxY } : null;

  for (let i = 0; i < strokes.length; i++) {
    if (isBody[i]) continue;
    const diag = bboxDiag(boxes[i]!);
    const small = diag <= maxDotDiag || strokes[i]!.length <= maxDotLen;
    if (!small) continue;

    let isolated = true;
    for (let j = 0; j < strokes.length; j++) {
      if (j === i) continue;
      if (bboxGap(boxes[i]!, boxes[j]!) <= isolationThreshold) {
        isolated = false;
        break;
      }
    }

    // Accents that hug the letter top fail isolation but still sit outside the
    // body bbox. Prefer a strict above/below split; also accept a centroid that
    // sits outside the body with a positive gap (lightly separated marks).
    let outsideBody = false;
    if (bodyBox) {
      const b = boxes[i]!;
      const cy = (b.minY + b.maxY) / 2;
      const fullyAboveOrBelow = b.maxY < bodyBox.minY || b.minY > bodyBox.maxY;
      const centroidOutside = cy < bodyBox.minY || cy > bodyBox.maxY;
      outsideBody = fullyAboveOrBelow || (centroidOutside && bboxGap(b, bodyBox) > 0);
    }

    if (isolated || outsideBody) strokes[i]!.priority = -1;
  }
}

/**
 * Move priority-tagged strokes after priority-0 strokes while preserving the
 * relative order inside each tier. Higher priority draws first (0 > -1), so
 * bodies come before dots. Stroke `order` is reassigned so the array index
 * matches the draw sequence before `toFontUnits` accumulates delays.
 */
function reorderByPriority(strokes: Stroke[]): void {
  const hasPriority = strokes.some((s) => (s.priority ?? 0) < 0);
  if (!hasPriority) return;
  strokes.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.order - b.order);
  for (let i = 0; i < strokes.length; i++) strokes[i]!.order = i;
}
