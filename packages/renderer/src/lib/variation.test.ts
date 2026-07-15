import { describe, expect, test } from 'bun:test';
import { findEffect, resolveEffects } from './effects.ts';
import { varyPoint, varyPolyline } from './variation.ts';

describe('varyPoint (issue #31 skeleton variation)', () => {
  test('same seed + params yields identical geometry (stable when controlled)', () => {
    const a = varyPoint(100, 200, 3, 42, { amplitude: 15, frequency: 0.8 });
    const b = varyPoint(100, 200, 3, 42, { amplitude: 15, frequency: 0.8 });
    expect(a).toEqual(b);
  });

  test('different seeds yield different geometry (per-render variation)', () => {
    const a = varyPoint(100, 200, 3, 1, { amplitude: 15, frequency: 0.8 });
    const b = varyPoint(100, 200, 3, 2, { amplitude: 15, frequency: 0.8 });
    expect(a.x !== b.x || a.y !== b.y).toBe(true);
  });

  test('amplitude 0 is identity (variation disabled path)', () => {
    const a = varyPoint(100, 200, 0, 99, { amplitude: 0 });
    expect(a).toEqual({ x: 100, y: 200 });
  });

  test('default amplitude displaces the point away from the source', () => {
    const a = varyPoint(0, 0, 0, 7);
    // Default amplitude 12: noise maps to [-12, 12]; almost never zero for both axes.
    expect(Math.hypot(a.x, a.y)).toBeGreaterThan(0);
    expect(Math.abs(a.x)).toBeLessThanOrEqual(12 + 1e-9);
    expect(Math.abs(a.y)).toBeLessThanOrEqual(12 + 1e-9);
  });

  test('preserves character DNA: displacement stays within amplitude bound', () => {
    const amplitude = 20;
    for (let seed = 0; seed < 20; seed++) {
      const a = varyPoint(50, -100, seed % 5, seed * 13.7, { amplitude });
      expect(Math.abs(a.x - 50)).toBeLessThanOrEqual(amplitude + 1e-9);
      expect(Math.abs(a.y - -100)).toBeLessThanOrEqual(amplitude + 1e-9);
    }
  });
});

describe('varyPolyline', () => {
  const stroke = [
    [0, 0, 10],
    [50, 10, 12],
    [100, 0, 10],
  ] as [number, number, number][];

  test('disabled (amplitude 0) returns equal coordinates', () => {
    const out = varyPolyline(stroke, 5, { amplitude: 0 });
    expect(out.map((p) => [p[0], p[1]])).toEqual(stroke.map((p) => [p[0], p[1]]));
    // widths preserved
    expect(out.map((p) => p[2])).toEqual([10, 12, 10]);
  });

  test('enabled: successive seeds produce different polylines; input not mutated', () => {
    const clone = stroke.map((p) => p.slice() as [number, number, number]);
    const a = varyPolyline(stroke, 1, { amplitude: 18 });
    const b = varyPolyline(stroke, 999, { amplitude: 18 });
    expect(stroke).toEqual(clone); // purity
    let differed = false;
    for (let i = 0; i < a.length; i++) {
      if (a[i]![0] !== b[i]![0] || a[i]![1] !== b[i]![1]) differed = true;
    }
    expect(differed).toBe(true);
    // Width channel untouched
    expect(a.map((p) => p[2])).toEqual([10, 12, 10]);
  });
});

describe('resolveEffects — variation', () => {
  test('variation is a known singleton effect', () => {
    const resolved = resolveEffects({ variation: { amplitude: 10 }, pressureWidth: false });
    expect(findEffect(resolved, 'variation')?.config).toEqual({ amplitude: 10 });
  });

  test('variation: true uses empty config (defaults apply at draw time)', () => {
    const resolved = resolveEffects({ variation: true, pressureWidth: false });
    expect(findEffect(resolved, 'variation')).toBeDefined();
  });
});
