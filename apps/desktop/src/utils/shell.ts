export function escapeShellArg(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function shellArgs(shellPath: string, command?: string) {
  const name = shellPath.split("/").pop() ?? "";
  if (command && name.includes("bash")) {
    return ["-l", "-i", "-c", command];
  }
  if (command && name.includes("zsh")) {
    return ["-l", "-i", "-c", command];
  }
  if (command && name.includes("fish")) {
    return ["-l", "-i", "-c", command];
  }
  if (name.includes("bash")) {
    return ["-l", "-i"];
  }
  if (name.includes("zsh")) {
    return ["-l", "-i"];
  }
  if (name.includes("fish")) {
    return ["-l", "-i"];
  }
  return command ? ["-c", command] : ([] as string[]);
}
