import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { quoteAgentCommandPath } from "./execute.js";

/**
 * acpx splits `--agent` shell-style. A macOS app bundle path contains a space
 * ("Paperclip Desktop.app"), which used to spawn `/Applications/Paperclip`.
 */
describe("quoteAgentCommandPath", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pc agent bin-"));
  const spaced = path.join(dir, "claude-agent-acp");
  writeFileSync(spaced, "#!/usr/bin/env node\n");
  chmodSync(spaced, 0o755);

  it("quotes an existing path that contains a space", () => {
    expect(spaced).toContain(" ");
    expect(quoteAgentCommandPath(spaced)).toBe(`"${spaced}"`);
  });

  it("leaves a space-free path untouched", () => {
    expect(quoteAgentCommandPath("/usr/local/bin/claude-agent-acp")).toBe(
      "/usr/local/bin/claude-agent-acp",
    );
  });

  it("leaves a multi-word command alone so it still splits into command + args", () => {
    expect(quoteAgentCommandPath("npx claude-agent-acp")).toBe("npx claude-agent-acp");
  });

  it("does not double-quote an already quoted command", () => {
    const already = `"${spaced}"`;
    expect(quoteAgentCommandPath(already)).toBe(already);
  });

  it("escapes quotes and backslashes inside the path", () => {
    const nasty = mkdtempSync(path.join(os.tmpdir(), 'pc "odd" dir-'));
    const bin = path.join(nasty, "agent bin");
    writeFileSync(bin, "#!/bin/sh\n");
    const quoted = quoteAgentCommandPath(bin)!;
    expect(quoted.startsWith('"')).toBe(true);
    expect(quoted.endsWith('"')).toBe(true);
    // Inner quotes are escaped rather than terminating the token early.
    expect(quoted.slice(1, -1)).toBe(bin.replace(/(["\\])/g, "\\$1"));
  });

  it("passes through null and empty input", () => {
    expect(quoteAgentCommandPath(null)).toBeNull();
    expect(quoteAgentCommandPath("")).toBe("");
  });
});
