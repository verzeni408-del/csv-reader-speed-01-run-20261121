// Fast driver: reads cases.json as latin1 bytes (byte-preserving), runs the
// single-pass transformer (transformRaw), writes answers.json.
// Falls back to the plain JSON.parse + run() path if the transformer
// rejects the input, so correctness never depends on the fast path.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
setFlagsFromString('--no-incremental-marking');
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };
const { transformRaw } = (await import(new URL('./transform.js', import.meta.url).href)) as { transformRaw: (raw: string) => string };
const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const raw = readFileSync(join(INPUT_DIR, 'cases.json'), 'latin1');
let outBuf: Buffer;
try {
  outBuf = Buffer.from(transformRaw(raw), 'latin1');
} catch {
  const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
  const answers: unknown[] = [];
  for (const c of cases) answers.push(run(c.input));
  outBuf = Buffer.from(JSON.stringify(answers), 'utf8');
}
writeFileSync(join(OUTPUT_DIR, 'answers.json'), outBuf);
