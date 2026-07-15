import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { orderStrokes } from './stroke-order.ts';

/** Build a polyline from [x,y] pairs. */
function poly(...xy: [number, number][]): Point[] {
  return xy.map(([x, y]) => ({ x, y }));
}

/**
 * Synthetic glyph geometry helpers — y increases downward (bitmap space).
 * Accents sit at small y (top); body occupies the lower/mid region.
 */
function order(polylines: Point[][]) {
  // inverseDT null + width dummy: width defaults to 1
  return orderStrokes(polylines, null, 100);
}

function startDelayOrder(strokes: ReturnType<typeof order>) {
  // After orderStrokes, array index === draw order (order field reassigned)
  return strokes.map((s, i) => ({
    i,
    order: s.order,
    priority: s.priority ?? 0,
    length: Math.round(s.length * 10) / 10,
    cy: Math.round((s.points.reduce((a, p) => a + p.y, 0) / s.points.length) * 10) / 10,
  }));
}

describe('orderStrokes — accent / diacritic deferral (issue #27)', () => {
  test('i-dot (small isolated top mark) is deferred after the body stem', () => {
    // Accent polyline listed first (trace often yields top-first order)
    const strokes = order([
      poly([50, 10], [52, 12]), // i-dot
      poly([50, 40], [50, 100]), // stem
    ]);
    expect(strokes).toHaveLength(2);
    expect(strokes[0]!.priority ?? 0).toBe(0); // body first
    expect(strokes[1]!.priority).toBe(-1); // dot deferred
    expect(strokes[0]!.order).toBe(0);
    expect(strokes[1]!.order).toBe(1);
  });

  test('circumflex-like accent above o-body is deferred (côte-style ô)', () => {
    // Accent first in input (top-to-bottom trace order) — the bug case
    const circumflex = poly([40, 12], [50, 4], [60, 12]);
    // Closed-ish o body in the mid region
    const body: Point[] = [];
    for (let a = 0; a < Math.PI * 2; a += 0.25) {
      body.push({ x: 50 + 28 * Math.cos(a), y: 70 + 28 * Math.sin(a) });
    }
    const strokes = order([circumflex, body]);
    const info = startDelayOrder(strokes);
    // Body must draw first even though accent was listed first
    expect(strokes[0]!.priority ?? 0).toBe(0);
    expect(strokes[1]!.priority).toBe(-1);
    // Accent is the shorter stroke
    expect(strokes[1]!.length).toBeLessThan(strokes[0]!.length);
    // Sanity: body centroid lower (higher y) than accent
    expect(info[0]!.cy).toBeGreaterThan(info[1]!.cy);
  });

  test('Greek tonos-like accent close to letter top is still deferred (εικόνα-style)', () => {
    // Longer thin tonos sitting close above the body — isolation-only heuristics fail here
    const tonos = poly([55, 8], [60, 22]);
    const body: Point[] = [];
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      body.push({ x: 50 + 22 * Math.cos(a), y: 65 + 30 * Math.sin(a) });
    }
    const strokes = order([tonos, body]);
    expect(strokes[0]!.priority ?? 0).toBe(0);
    expect(strokes[1]!.priority).toBe(-1);
  });

  test('umlaut-like pair of small marks above body are both deferred', () => {
    const leftDot = poly([35, 10], [38, 12]);
    const rightDot = poly([62, 10], [65, 12]);
    const body = poly([30, 40], [70, 40], [70, 100], [30, 100], [30, 40]);
    const strokes = order([leftDot, rightDot, body]);
    expect(strokes[0]!.priority ?? 0).toBe(0); // body
    expect(strokes[1]!.priority).toBe(-1);
    expect(strokes[2]!.priority).toBe(-1);
  });

  test('similar-sized multi-stroke glyph does not defer body components as diacritics', () => {
    // Mimic two comparable strokes (e.g. equals sign / CJK-like parity) — neither is a mark
    const top = poly([10, 30], [90, 30]);
    const bottom = poly([10, 70], [90, 70]);
    const strokes = order([top, bottom]);
    expect(strokes.every((s) => (s.priority ?? 0) === 0)).toBe(true);
  });

  test('single stroke is never marked as a deferred diacritic', () => {
    const strokes = order([poly([10, 10], [90, 90])]);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.priority ?? 0).toBe(0);
  });
});

describe('orderStrokes — RTL orientation still works with diacritic deferral', () => {
  test('defers isolated mark after body in RTL mode', () => {
    const mark = poly([50, 10], [52, 12]);
    const body = poly([80, 40], [20, 40], [20, 100]);
    const strokes = orderStrokes([mark, body], null, 100, 3, undefined, true);
    expect(strokes[0]!.priority ?? 0).toBe(0);
    expect(strokes[1]!.priority).toBe(-1);
  });
});

describe('orderStrokes — CJK multi-stroke must not get diacritic priority (issue #27/#52)', () => {
  test('even-ish multi-stroke glyph (下-like) keeps all strokes at priority 0', () => {
    // Three intentional body strokes of comparable length — no single accent mark.
    const top = poly([10, 20], [90, 20]);
    const mid = poly([50, 20], [50, 90]);
    const bottom = poly([20, 90], [80, 90]);
    const strokes = order([top, mid, bottom]);
    expect(strokes.every((s) => (s.priority ?? 0) === 0)).toBe(true);
  });

  test('four-stroke character with no dominant body is never deferred', () => {
    const s1 = poly([10, 10], [90, 10]);
    const s2 = poly([10, 40], [90, 40]);
    const s3 = poly([10, 70], [90, 70]);
    const s4 = poly([50, 10], [50, 90]);
    const strokes = order([s1, s2, s3, s4]);
    expect(strokes.every((s) => (s.priority ?? 0) === 0)).toBe(true);
  });
});
