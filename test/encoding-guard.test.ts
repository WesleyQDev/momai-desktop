import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'runtime.ts',
  'worker.ts',
  'desktop/runs.ts',
  'uia/nodes.ts',
  'uia/provider.ts',
  'SKILL.md',
  'AUTOMATION.md',
]

// A past scare showed tool output mangling non-ASCII text: byte-level check
// proved the sources were clean UTF-8. This guard locks that in — any real
// CP1252/double-encoding accident (C1 controls, stray â/Ã sequences from a
// latin1 round-trip) fails fast instead of shipping mojibake to the model.
describe('source encoding guard', () => {
  it('decodes every source file as clean UTF-8', () => {
    for (const name of files) {
      const buf = readFileSync(join(root, name))
      const text = buf.toString('utf8')
      expect(text, `${name} must be valid UTF-8`).not.toContain('�')
    }
  })

  it('contains no C1 control characters (double-encoding smoking gun)', () => {
    for (const name of files) {
      const text = readFileSync(join(root, name), 'utf8')
      // eslint-disable-next-line no-control-regex
      expect(text, `${name} must not contain C1 controls`).not.toMatch(/[\u0080-\u009F]/)
    }
  })

  it('contains no latin1 round-trip artifacts', () => {
    for (const name of files) {
      const text = readFileSync(join(root, name), 'utf8')
      expect(text, `${name} must not contain mojibake`).not.toMatch(/â€|â”|Ã©|Ã¨|Ã£|Ã§|Ãª|Ã³|Ã­|Ã¢|Ãº|Ã´|Ã‰/)
    }
  })
})
