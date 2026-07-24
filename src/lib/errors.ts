import type { Request, Response, NextFunction, RequestHandler } from "express";
import { log } from "./logger";

export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "bad_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Wrap an async handler so rejections reach the error middleware. */
export function asyncRoute(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: "not_found", path: req.path });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const isApp = err instanceof AppError;
  const status = isApp ? err.status : 500;
  const code = isApp ? err.code : "internal_error";
  const message = err instanceof Error ? err.message : "unknown error";

  log.error("request failed", {
    method: req.method,
    path: req.path,
    status,
    code,
    detail: message,
  });

  if (res.headersSent) return;
  res.status(status).json({
    error: code,
    message: status === 500 ? "Something went wrong on our side." : message,
  });
}
