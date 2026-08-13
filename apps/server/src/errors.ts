import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';

export class AppError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: readonly { path: string; code: string }[]
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'The requested endpoint does not exist.',
      requestId: response.locals.requestId
    }
  });
};

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new AppError(
      400,
      'INVALID_INPUT',
      'The request payload is invalid.',
      error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }))
    );
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new AppError(413, 'IMAGE_TOO_LARGE', 'Each screenshot must be 5 MB or smaller.');
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return new AppError(400, 'INVALID_SCREENSHOT_COUNT', 'Upload between one and three screenshots.');
    }
    return new AppError(400, 'INVALID_MULTIPART_REQUEST', 'The screenshot upload is invalid.');
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.too.large'
  ) {
    return new AppError(413, 'JSON_TOO_LARGE', 'The JSON request body is too large.');
  }

  if (
    error instanceof SyntaxError ||
    (typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'entity.parse.failed')
  ) {
    return new AppError(400, 'INVALID_JSON', 'The JSON request body is invalid.');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'The server could not complete the request.');
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  void _next;
  const appError = toAppError(error);
  response.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      requestId: response.locals.requestId,
      ...(appError.details ? { details: appError.details } : {})
    }
  });
};
