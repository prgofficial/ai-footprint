import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getLogger } from '@ai-footprint/config';
import type { UserFacingError } from '@ai-footprint/shared';

const GENERIC: UserFacingError = {
  title: 'Something went wrong',
  message: 'AI Footprint could not complete that request. Try again in a moment.',
  statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
};

function isPayloadTooLarge(exception: unknown): boolean {
  if (!(exception instanceof Error)) return false;
  const candidate = exception as Error & { type?: string; status?: number; statusCode?: number };
  return (
    candidate.type === 'entity.too.large' ||
    candidate.status === HttpStatus.PAYLOAD_TOO_LARGE ||
    candidate.statusCode === HttpStatus.PAYLOAD_TOO_LARGE
  );
}

@Catch()
export class UserFacingExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let payload: UserFacingError = GENERIC;

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const status = exception.getStatus();
      payload =
        typeof body === 'object' && body !== null && 'title' in body
          ? (body as UserFacingError)
          : {
              title: status === HttpStatus.NOT_FOUND ? 'Not found' : 'Request failed',
              message:
                typeof body === 'string'
                  ? body
                  : ((body as { message?: string }).message ??
                    'The request could not be completed.'),
              statusCode: status,
            };
    } else if (isPayloadTooLarge(exception)) {
      // Body parsers throw a plain Error with a status, which would otherwise be reported as
      // an internal failure the caller should retry, when retrying can only fail again.
      payload = {
        title: 'That request was too large',
        message:
          'The request body exceeded the size this endpoint accepts. Send the events in smaller batches.',
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      };
    } else if (exception instanceof Error) {
      payload = { ...GENERIC, details: exception.message };
      getLogger().error(
        { path: request.path, method: request.method, err: exception },
        'unhandled request failure',
      );
    }

    response.status(payload.statusCode).json(payload);
  }
}
