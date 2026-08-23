// The execution environment's native SWC addon SIGBUS-es on load. Next's
// supported WASM fallback is deterministic and is already a project
// dependency; marking this process as web-container makes Next prefer it.
if (!process.versions.webcontainer) {
  process.versions.webcontainer = 'lastmile-wasm';
}
