export interface AppError extends Error {
  statusCode: number;
  code: string;
  retryable: boolean;
}

export function createAppError(
  statusCode: number,
  code: string,
  message: string,
  retryable = false,
): AppError {
  const error = new Error(message) as AppError;
  error.name = "AppError";
  error.statusCode = statusCode;
  error.code = code;
  error.retryable = retryable;
  return error;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof Error
    && error.name === "AppError"
    && "statusCode" in error
    && "code" in error
    && "retryable" in error;
}
