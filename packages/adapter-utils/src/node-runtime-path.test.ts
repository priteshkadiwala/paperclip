import { mkdtempSync, chmodSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureNodeRuntimeOnPath } from "./server-utils.js";

/**
 * Local ACP adapter shims carry a `#!/usr/bin/env node` shebang and are spawned
 * directly, so a child PATH without Node fails at exec time. A desktop app
 * launched from Finder has exactly that PATH.
 */
describe("ensureNodeRuntimeOnPath", () => {
  const runtimeDir = path.dirname(process.execPath);

  it("prepends the running Node's directory when PATH cannot resolve node", () => {
    const emptyDir = mkdtempSync(path.join(os.tmpdir(), "pc-nopath-"));
    const result = ensureNodeRuntimeOnPath({ PATH: emptyDir });
    expect(result.PATH?.split(path.delimiter)[0]).toBe(runtimeDir);
    // The original entries survive.
    expect(result.PATH?.split(path.delimiter)).toContain(emptyDir);
  });

  it("leaves PATH untouched when it already resolves a node", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pc-withnode-"));
    const fake = path.join(dir, process.platform === "win32" ? "node.exe" : "node");
    writeFileSync(fake, "#!/bin/sh\nexit 0\n");
    chmodSync(fake, 0o755);
    const result = ensureNodeRuntimeOnPath({ PATH: dir });
    expect(result.PATH).toBe(dir);
  });

  it("does not duplicate the runtime directory when it is already present", () => {
    const result = ensureNodeRuntimeOnPath({ PATH: runtimeDir });
    expect(result.PATH).toBe(runtimeDir);
  });

  it("fills a missing PATH and still guarantees a node runtime", () => {
    const result = ensureNodeRuntimeOnPath({});
    expect(typeof result.PATH).toBe("string");
    expect(result.PATH?.length ?? 0).toBeGreaterThan(0);
  });

  it("ignores a directory entry that merely contains a non-executable node file", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pc-dirnode-"));
    mkdirSync(path.join(dir, "node"));
    const result = ensureNodeRuntimeOnPath({ PATH: dir });
    // A directory named "node" is not an interpreter; the real runtime is added.
    expect(result.PATH?.split(path.delimiter)[0]).toBe(runtimeDir);
  });
});
