export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Window event announcing each API call, so ActionFeedback can show progress and a result notice for every action. */
export const API_ACTIVITY_EVENT = "wr:api-activity";

export type ApiActivity =
  | { id: number; phase: "start" }
  | { id: number; phase: "end"; method: "POST" | "PATCH" | "PUT" | "DELETE"; ok: boolean; code?: string; quiet: boolean };

let nextActivityId = 0;

function announce(detail: ApiActivity) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<ApiActivity>(API_ACTIVITY_EVENT, { detail }));
}

/**
 * Browser-side call to the API through the same origin, so the session cookie is sent. Every call is announced
 * (start and result) so the clicked control shows a spinner and a notice confirms or explains the outcome;
 * `quiet` skips the success notice for calls whose result is already obvious on screen.
 */
export async function apiSend<T = unknown>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  options: { quiet?: boolean } = {},
): Promise<T> {
  const id = ++nextActivityId;
  const quiet = options.quiet ?? false;
  announce({ id, phase: "start" });
  try {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new ApiError(response.status, data.error ?? "unknown_error");
    announce({ id, phase: "end", method, ok: true, quiet });
    return data as T;
  } catch (err) {
    announce({ id, phase: "end", method, ok: false, code: err instanceof ApiError ? err.code : "network_error", quiet });
    throw err;
  }
}
