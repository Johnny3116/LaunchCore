/** Common Windows Installer / installer exit codes. */
const KNOWN: Record<number, string> = {
  0: "success",
  1602: "user cancelled",
  1603: "fatal error during installation",
  1618: "another installation is already in progress",
  1619: "installation package could not be opened",
  1625: "installation prohibited by system policy",
  1638: "another version of this product is already installed",
  1641: "success, reboot initiated",
  3010: "success, reboot required",
};

export function describeExitCode(code: number): string {
  const known = KNOWN[code];
  if (known) return known;
  // winget and some installers return HRESULT-style codes; hex is what you'd search for.
  if (code > 0xffff || code < 0) return `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  return "unrecognized exit code";
}
