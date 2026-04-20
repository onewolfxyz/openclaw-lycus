import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 1024 * 1024;

export async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Request body too large"), {
        statusCode: 413,
      });
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export function parseJsonBody<T>(body: Buffer): T {
  if (body.length === 0) {
    throw Object.assign(new Error("Request body is required"), {
      statusCode: 400,
    });
  }

  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), {
      statusCode: 400,
    });
  }
}

export function verifyBearerToken(req: IncomingMessage, expected?: string): boolean {
  if (!expected) return false;
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  return constantTimeEqual(header.slice("Bearer ".length), expected);
}

export function verifyHmacSignature(
  req: IncomingMessage,
  body: Buffer,
  secret?: string,
): boolean {
  if (!secret) return false;

  const supplied = firstHeader(req.headers["x-claw-signature"]);
  if (!supplied) return false;

  const actual = createHmac("sha256", secret).update(body).digest("hex");
  const expected = supplied.startsWith("sha256=")
    ? supplied.slice("sha256=".length)
    : supplied;

  return constantTimeEqual(actual, expected);
}

export function writeJson(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

export function errorStatus(error: unknown): number {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }

  return 500;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
