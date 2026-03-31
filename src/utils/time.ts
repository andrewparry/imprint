import { ulid } from "ulid";

export function generateId(): string {
  return ulid();
}

export function now(): string {
  return new Date().toISOString();
}

export function daysBetween(a: string | Date, b: string | Date): number {
  const dateA = typeof a === "string" ? new Date(a) : a;
  const dateB = typeof b === "string" ? new Date(b) : b;
  const ms = Math.abs(dateB.getTime() - dateA.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
