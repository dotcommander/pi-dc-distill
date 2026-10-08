/** JSON objects at the isolated host journal/RPC trust boundary. */
import { readFileSync } from "node:fs";
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected host JSON object");
  return value as Record<string, unknown>;
}
export interface HostRecord extends Record<string, unknown> {
  details?: Record<string, unknown>;
  message?: Record<string, unknown>;
}
export function hostRecord(value: unknown): HostRecord {
  const result = object(value);
  return { ...result,
    ...(result.details === undefined ? {} : { details: object(result.details) }),
    ...(result.message === undefined ? {} : { message: object(result.message) }),
  };
}
export function readRecords(file: string): HostRecord[] {
  return readFileSync(file, "utf8").split("\n").filter(line => line.trim()).map(line => hostRecord(JSON.parse(line)));
}
