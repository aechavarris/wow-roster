import { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const unauthorized = () => new HttpError(401, "unauthorized");
export const forbidden = () => new HttpError(403, "forbidden");
export const notFound = (what = "not_found") => new HttpError(404, what);

/** Validates a game version id (route param or body field) against the loaded versions. */
export const gameVersionSchema = (versions: { byId: Map<string, unknown> }) =>
  z.string().refine((id) => versions.byId.has(id), { message: "unknown_game_version" });
