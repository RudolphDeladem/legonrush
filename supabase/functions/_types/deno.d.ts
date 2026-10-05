// Only for checking these functions with plain TypeScript (`npx tsc -p supabase/functions`).
// Supabase runs them on Deno, which has these built in; this file is never deployed or imported.
declare namespace Deno {
  const env: { get(name: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}
