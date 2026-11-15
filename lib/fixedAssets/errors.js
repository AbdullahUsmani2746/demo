// lib/fixedAssets/errors.js — a refusal with its HTTP status.
export class FaError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Route helper: FaError → its status, anything else → rethrown. */
export function faErrorBody(error) {
  if (error instanceof FaError) return { body: { message: error.message, error: error.message }, status: error.status };
  // The database refused (e.g. the one-posted-run-per-month index): say so plainly.
  if (error?.code === "P2002") return { body: { message: "This was saved a moment ago by someone else — refresh." }, status: 409 };
  return null;
}
