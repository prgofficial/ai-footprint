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
