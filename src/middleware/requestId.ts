import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestId(request: Request, response: Response, next: NextFunction) {
  const candidate = request.header("x-request-id");
  const id = candidate && /^[A-Za-z0-9._-]{1,80}$/.test(candidate) ? candidate : randomUUID();
  response.locals.requestId = id;
  response.setHeader("X-Request-ID", id);
  next();
}
