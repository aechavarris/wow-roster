import "server-only";
import { cookies } from "next/headers";
import type { MeResponse, PublicConfig } from "./types";

const API_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** Server-side GET to the API forwarding the visitor's cookies. Returns null on 404. */
export async function apiGet<T>(path: string): Promise<T | null> {
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(`${API_URL}/api${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`API ${response.status} on ${path}`);
  return (await response.json()) as T;
}

export async function getConfig(): Promise<PublicConfig> {
  // Short cache: the config changes with deploys and with GAME_PROFILE edits.
  const response = await fetch(`${API_URL}/api/config`, { next: { revalidate: 60 } });
  if (!response.ok) throw new Error(`API ${response.status} on /config`);
  return (await response.json()) as PublicConfig;
}

export async function getMe(): Promise<MeResponse> {
  try {
    return (await apiGet<MeResponse>("/me")) ?? { user: null };
  } catch {
    return { user: null };
  }
}
