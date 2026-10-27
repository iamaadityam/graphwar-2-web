export type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ at: new Date().toISOString(), level, event, ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
