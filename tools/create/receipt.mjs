/** Provenance for a generated project. All values are non-secret by construction. */
export function buildReceipt({ forgeCommit, mode, tokens }) {
  return {
    forgeCommit,
    generatedAt: new Date().toISOString(),
    mode,
    tokens,
  };
}
