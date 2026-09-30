import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentCommandCheck } from "../../shared/types";
import {
  SHELL_CANDIDATES,
  checkAgentCommands,
  createSpawnCommandProbe,
  getDefaultShell,
  isSafeCommandName,
  probeScript,
  shellArgsForCommand,
} from "./system";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getDefaultShell", () => {
  it("prefers $SHELL", () => {
    expect(getDefaultShell({ env: { SHELL: "/opt/homebrew/bin/fish" }, exists: () => true })).toBe(
      "/opt/homebrew/bin/fish",
    );
  });

  it("ignores a blank $SHELL", () => {
    expect(getDefaultShell({ env: { SHELL: "   " }, exists: (candidate) => candidate === "/bin/bash" })).toBe(
      "/bin/bash",
    );
  });

  it("falls back in candidate order", () => {
    const seen: string[] = [];
    const shell = getDefaultShell({
      env: {},
      exists: (candidate) => {
        seen.push(candidate);
        return candidate === "/usr/bin/bash";
      },
    });
    expect(shell).toBe("/usr/bin/bash");
    expect(seen).toEqual(SHELL_CANDIDATES.slice(0, SHELL_CANDIDATES.indexOf("/usr/bin/bash") + 1));
  });

  it("throws when nothing is available", () => {
    expect(() => getDefaultShell({ env: {}, exists: () => false })).toThrow(/Unable to determine default shell/u);
  });
});

describe("shellArgsForCommand", () => {
  it("uses a login interactive shell for rc-reading shells", () => {
    for (const shell of ["/bin/bash", "/bin/zsh", "/opt/homebrew/bin/fish"]) {
      expect(shellArgsForCommand(shell, "command -v claude")).toEqual([
        "-l",
        "-i",
        "-c",
        "command -v claude",
      ]);
    }
  });

  it("uses a plain -c otherwise", () => {
    expect(shellArgsForCommand("/bin/sh", "command -v claude")).toEqual(["-c", "command -v claude"]);
    expect(shellArgsForCommand("/usr/bin/dash", "x")).toEqual(["-c", "x"]);
  });
});

describe("probeScript", () => {
  it("collapses every candidate into one short circuiting script", () => {
    expect(probeScript(["codex", "codex-cli"])).toBe(
      "command -v codex >/dev/null 2>&1 || command -v codex-cli >/dev/null 2>&1",
    );
  });
});

describe("isSafeCommandName", () => {
  it("accepts bare command names", () => {
    for (const name of ["claude", "codex", "my-agent", "my_agent", "agent.sh", "agent2"]) {
      expect(isSafeCommandName(name)).toBe(true);
    }
  });

  it("rejects anything that could escape the probe script", () => {
    for (const name of ["", "claude; rm -rf /", "/usr/local/bin/claude", "claude arg", "$(evil)", "a`b`"]) {
      expect(isSafeCommandName(name)).toBe(false);
    }
  });
});

describe("checkAgentCommands", () => {
  const checks: AgentCommandCheck[] = [
    { agent: "claude", commands: ["claude"] },
    { agent: "codex", commands: ["codex", "codex-cli"] },
  ];

  it("reports a command as available when any candidate resolves", async () => {
    const probe = vi.fn(async (_shell: string, commands: string[]) => commands.includes("codex-cli"));
    await expect(checkAgentCommands(checks, { shell: "/bin/zsh", probe })).resolves.toEqual({
      claude: false,
      codex: true,
    });
  });

  it("spends one shell per agent, not one per candidate", async () => {
    const probe = vi.fn(async () => true);
    await checkAgentCommands(checks, { shell: "/bin/zsh", probe });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe).toHaveBeenCalledWith("/bin/zsh", ["claude"]);
    expect(probe).toHaveBeenCalledWith("/bin/zsh", ["codex", "codex-cli"]);
  });

  it("drops candidates that cannot be interpolated safely", async () => {
    const probe = vi.fn(async () => true);
    await expect(
      checkAgentCommands([{ agent: "claude", commands: [" claude ", "/usr/local/bin/claude", ""] }], {
        shell: "/bin/zsh",
        probe,
      }),
    ).resolves.toEqual({ claude: true });
    expect(probe).toHaveBeenCalledWith("/bin/zsh", ["claude"]);
  });

  it("reports an agent with no probeable candidate as missing", async () => {
    const probe = vi.fn(async () => true);
    await expect(
      checkAgentCommands([{ agent: "claude", commands: [] }], { shell: "/bin/zsh", probe }),
    ).resolves.toEqual({ claude: false });
    expect(probe).not.toHaveBeenCalled();
  });

  it("probes only the first token of a custom command", async () => {
    const probe = vi.fn(async () => true);
    await expect(
      checkAgentCommands([{ agent: "claude", commands: ["claude"], customCommand: "  claude --resume  " }], {
        shell: "/bin/zsh",
        probe,
      }),
    ).resolves.toEqual({ claude: true });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith("/bin/zsh", ["claude"]);
  });

  it("assumes a custom command that cannot be probed safely is present", async () => {
    const probe = vi.fn(async () => false);
    await expect(
      checkAgentCommands([{ agent: "claude", commands: ["claude"], customCommand: "/usr/local/bin/claude" }], {
        shell: "/bin/zsh",
        probe,
      }),
    ).resolves.toEqual({ claude: true });
    expect(probe).not.toHaveBeenCalled();
  });

  it("shares one probe per distinct candidate set", async () => {
    const probe = vi.fn(async () => true);
    await checkAgentCommands(
      [
        { agent: "one", commands: ["claude"] },
        { agent: "two", commands: ["claude"] },
      ],
      { shell: "/bin/zsh", probe },
    );
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("spawnCommandProbe", () => {
  it("finds a command that exists", async () => {
    await expect(createSpawnCommandProbe(10_000)("/bin/sh", ["nope-not-a-command", "env"])).resolves.toBe(true);
  });

  it("reports a clean non-zero exit as missing", async () => {
    await expect(createSpawnCommandProbe(10_000)("/bin/sh", ["codelegate-nonexistent-agent"])).resolves.toBe(
      false,
    );
  });

  it("assumes a probe that had to be killed is available", async () => {
    // A "shell" that never answers: the Rust original waited forever, so a slow
    // login shell must not be allowed to report an installed agent as missing.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codelegate-probe-"));
    const slowShell = path.join(dir, "slow-shell");
    fs.writeFileSync(slowShell, "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(createSpawnCommandProbe(150)(slowShell, ["claude"])).resolves.toBe(true);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports an unspawnable shell as missing", async () => {
    await expect(createSpawnCommandProbe(150)("/nonexistent/shell", ["claude"])).resolves.toBe(false);
  });
});
