// The execution environment's native SWC addon SIGBUS-es on load in some local sandboxes.
// Next's supported WASM fallback is deterministic. On Netlify/Vercel/CI, let standard native compilation run.
if (!process.env.NETLIFY && !process.env.VERCEL && !process.env.CI && !process.versions.webcontainer) {
  process.versions.webcontainer = 'lastmile-wasm';
}
