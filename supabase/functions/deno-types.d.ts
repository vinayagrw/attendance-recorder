// Minimal ambient typings so the plain TypeScript server stops complaining
// about Deno globals and URL imports inside supabase/functions/.
//
// This is intentionally narrow: only the surface our functions actually use.
// For full Deno intellisense (autocomplete on Deno.serve options, etc.)
// install the official "Deno" VS Code extension (denoland.vscode-deno) and
// scope it to this folder via .vscode/settings.json.

declare namespace Deno {
  export const env: {
    get(key: string): string | undefined
    set(key: string, value: string): void
    has(key: string): boolean
    delete(key: string): void
    toObject(): Record<string, string>
  }

  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
  ): { finished: Promise<void>; shutdown(): Promise<void> }
  export function serve(
    options: {
      port?: number
      hostname?: string
      onListen?: (params: { hostname: string; port: number }) => void
    },
    handler: (req: Request) => Response | Promise<Response>,
  ): { finished: Promise<void>; shutdown(): Promise<void> }
}

// URL imports for the modules our functions actually use. The runtime types
// are whatever Deno + esm.sh resolve to; for tsserver we surface only the
// named exports the code references, all typed `any`. Add a new declaration
// here when a function adds a new named import from a URL.
declare module 'https://esm.sh/@supabase/supabase-js@2.49.4' {
  export function createClient(url: string, key: string, options?: any): any
}

// Generic fallback for any other URL / Deno-style specifier the functions
// might use as a default-import-only or namespace-import-only module.
// Named imports will NOT work through this fallback — TS limitation. Add an
// explicit `declare module` entry above for each new named-import URL.
declare module 'https://*' {
  const _exports: any
  export default _exports
  export = _exports
}

declare module 'jsr:*' {
  const _exports: any
  export default _exports
  export = _exports
}

declare module 'npm:*' {
  const _exports: any
  export default _exports
  export = _exports
}
