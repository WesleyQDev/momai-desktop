declare module 'node:module' {
  export function createRequire(filename: string): (specifier: string) => any
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding?: string): any
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function dirname(path: string): string
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string
}

interface ImportMeta {
  url: string
}
