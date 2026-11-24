// Type-checking shim so `npm run typecheck:functions` can check Edge Functions with tsc.
declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
}
