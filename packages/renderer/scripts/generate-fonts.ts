// Orchestrates `tegaki-generator generate` for every bundled font. The Latin
// fonts use the generator's default ASCII set; the non-Latin fonts pass an
// explicit `--chars` from `./charsets.ts` (see notes there for what's
// included). Run via `bun --filter tegaki generate-fonts`.
//
// Ma Shan Zheng uses the library API with `useHanziStrokeData: true` so official
// hanzi-writer medians ship in glyphData (issue #52). The CLI flag path is
// retained for other fonts via spawn.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  ARABIC_CHARS,
  BENGALI_CHARS,
  DEFAULT_OPTIONS,
  DEVANAGARI_CHARS,
  extractTegakiBundle,
  HEBREW_CHARS,
  JAPANESE_CHARS,
  KOREAN_CHARS,
  SIMPLIFIED_CHINESE_CHARS,
} from 'tegaki-generator';
import { downloadFont } from '../../generator/src/font/download.ts';

interface FontSpec {
  family: string;
  /** Output directory under `packages/renderer/fonts/`. */
  dir: string;
  /** Custom subset; omit to use the generator's default ASCII set. */
  chars?: string;
  /** Prefer hanzi-writer-data medians for CJK ideographs (issue #52). */
  useHanziStrokeData?: boolean;
}

const FONTS: FontSpec[] = [
  { family: 'Caveat', dir: 'caveat' },
  { family: 'Italianno', dir: 'italianno' },
  { family: 'Tangerine', dir: 'tangerine' },
  { family: 'Parisienne', dir: 'parisienne' },
  { family: 'Suez One', dir: 'suez-one', chars: HEBREW_CHARS },
  { family: 'Klee One', dir: 'klee-one', chars: JAPANESE_CHARS },
  { family: 'Amiri', dir: 'amiri', chars: ARABIC_CHARS },
  { family: 'Tillana', dir: 'tillana', chars: DEVANAGARI_CHARS },
  { family: 'Atma', dir: 'atma', chars: BENGALI_CHARS },
  { family: 'Nanum Pen Script', dir: 'nanum-pen-script', chars: KOREAN_CHARS },
  {
    family: 'Ma Shan Zheng',
    dir: 'ma-shan-zheng',
    chars: SIMPLIFIED_CHINESE_CHARS,
    useHanziStrokeData: true,
  },
];

async function runViaCli(spec: FontSpec): Promise<void> {
  const args = ['--filter', 'tegaki-generator', 'start', 'generate', spec.family, '--output', `../renderer/fonts/${spec.dir}`];
  // Boolean flags before `--chars` — long multi-byte char sets can confuse
  // subsequent bare-flag parsing in some CLI layers.
  if (spec.useHanziStrokeData) args.push('--use-hanzi-stroke-data', 'true');
  if (spec.chars !== undefined) args.push('--chars', spec.chars);

  return new Promise((resolve, reject) => {
    const proc = spawn('bun', args, { stdio: 'inherit' });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`generate ${spec.family} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

/**
 * Library path for fonts that need `useHanziStrokeData`. Calls extractTegakiBundle
 * directly so the flag cannot be dropped by CLI arg parsing.
 */
async function runViaLibrary(spec: FontSpec): Promise<void> {
  const chars = spec.chars ?? '';
  const fontPaths = await downloadFont(spec.family, { chars: chars || undefined });
  const buffers = await Promise.all(fontPaths.map((p) => Bun.file(p).arrayBuffer()));
  const fullPaths = await downloadFont(spec.family);
  const fullBuf = await Bun.file(fullPaths[0]!).arrayBuffer();

  const bundle = await extractTegakiBundle({
    fontBuffer: buffers[0]!,
    fontFileName: basename(fontPaths[0]!),
    chars,
    options: DEFAULT_OPTIONS,
    extraFontBuffers: buffers.slice(1),
    requestedFamily: spec.family,
    subset: true,
    fullFontBuffer: fullBuf,
    fullFontFileName: basename(fullPaths[0]!),
    useHanziStrokeData: !!spec.useHanziStrokeData,
    onProgress: (msg, p) => {
      if (p !== undefined && Math.floor(p * 50) % 10 === 0) {
        console.log(`[${spec.dir}] ${Math.floor(p * 100)}% ${msg}`);
      }
    },
  });

  const outDir = join(import.meta.dir, '..', 'fonts', spec.dir);
  for (const file of bundle.files) {
    const filePath = join(outDir, file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    await Bun.write(filePath, file.content);
  }
  console.log(
    `[${spec.dir}] Processed ${bundle.stats.processed} glyphs (${bundle.stats.skipped} skipped) via library API` +
      (spec.useHanziStrokeData ? ' with useHanziStrokeData' : ''),
  );
}

async function runOne(spec: FontSpec): Promise<void> {
  if (spec.useHanziStrokeData) {
    await runViaLibrary(spec);
  } else {
    await runViaCli(spec);
  }
}

// Optional filter: `bun scripts/generate-fonts.ts caveat suez-one` regenerates
// only the listed bundles (matched by `dir`). Useful when adding a new font
// without re-running the slow Japanese pipeline.
const wanted = new Set(process.argv.slice(2));
const todo = wanted.size === 0 ? FONTS : FONTS.filter((f) => wanted.has(f.dir));

for (const spec of todo) {
  await runOne(spec);
}
