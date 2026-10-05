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
