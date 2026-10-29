import { messages } from "../config/messages.js";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { isAppError } from "../utils/AppError.js";

export const apiErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: messages.VALIDATION_ERROR,
        retryable: false,
        requestId: response.locals.requestId,
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    });
    return;
  }

  if (isAppError(error)) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        requestId: response.locals.requestId,
      },
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: messages.INVALID_JSON,
        retryable: false,
        requestId: response.locals.requestId,
      },
    });
    return;
  }

  if (typeof error === "object" && error !== null && "status" in error && error.status === 413) {
    response.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: messages.PAYLOAD_TOO_LARGE,
        retryable: false,
        requestId: response.locals.requestId,
      },
    });
    return;
  }

  console.error("Unhandled API error", { requestId: response.locals.requestId, error });
  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: messages.INTERNAL_ERROR,
      retryable: true,
      requestId: response.locals.requestId,
    },
  });
};
