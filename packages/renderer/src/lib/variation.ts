/**
 * Per-render skeleton path variation (issue #31).
 *
 * Applies a low-frequency, seed-stable displacement to stroke points so each
 * independent render (distinct seed) looks slightly different while preserving
 * the character's overall shape. Disabled / zero amplitude is an identity.
 *
 * Distinct from `wobble`, which adds high-frequency stroke jitter for style —
 * variation is meant to mimic "a different handwriting attempt" of the same letter.
 */

export interface VariationParams {
  /** Displacement scale in the same units as the input coordinates (font units when used from drawGlyph). Default 12. */
  amplitude?: number;
  /**
   * Spatial frequency of the noise field. Lower = larger structural drifts
   * (more "whole stroke" reshaping). Default 0.8.
   */
  frequency?: number;
}

/** Deterministic 0–1 hash (shared shape with drawGlyph's wobble noise). */
function hash(x: number): number {
  let h = (x * 2654435761) | 0;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = (h >>> 16) ^ h;
  return (h & 0x7fffffff) / 0x7fffffff;
}

function noise1d(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f);
  return hash(i + seed * 7919) * (1 - t) + hash(i + 1 + seed * 7919) * t;
}

/**
 * Displace a single stroke vertex. Same seed + params → identical output.
 * Different seeds → different geometry (typically by several font units).
 */
export function varyPoint(x: number, y: number, idx: number, seed: number, params: VariationParams = {}): { x: number; y: number } {
  const amplitude = params.amplitude ?? 12;
  if (amplitude === 0) return { x, y };

  const frequency = params.frequency ?? 0.8;
  // Low-frequency field: sample on position + slow along-stroke index so the
  // whole stroke drifts coherently rather than zig-zagging like wobble.
  const nx = noise1d(x * 0.01 * frequency + idx * 0.15, seed);
  const ny = noise1d(y * 0.01 * frequency + idx * 0.11, seed * 1.7 + 42);
  return {
    x: x + amplitude * (nx * 2 - 1),
    y: y + amplitude * (ny * 2 - 1),
  };
}

/**
 * Apply variation to an entire polyline of `[x, y, ...rest]` tuples (e.g. stroke.p).
 * Returns a new array; input is never mutated.
 */
export function varyPolyline<T extends number[]>(points: readonly T[], seed: number, params: VariationParams = {}): T[] {
  const amplitude = params.amplitude ?? 12;
  if (amplitude === 0 || points.length === 0) return points.map((p) => p.slice() as T);

  return points.map((p, idx) => {
    const v = varyPoint(p[0]!, p[1]!, idx, seed, params);
    const out = p.slice() as T;
    out[0] = v.x;
    out[1] = v.y;
    return out;
  });
}
