import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/u;

export const requestIdMiddleware: RequestHandler = (request, response, next) => {
  const incoming = request.header('x-request-id');
  const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  response.locals.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
};
