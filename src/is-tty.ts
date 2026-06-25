export function isTTY(): boolean {
  return process.stdout.isTTY ?? false;
}
