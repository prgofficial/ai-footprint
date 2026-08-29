import { HttpException, HttpStatus } from '@nestjs/common';
import type { UserFacingError } from '@ai-footprint/shared';

/**
 * Brief §39: the user must never see `ECONNREFUSED 127.0.0.1:4173`. Every error that can
 * reach a response carries a title and a plain-language message; the raw cause goes into
 * `details`, which the UI shows only behind "View technical details".
 */
export class AppError extends HttpException {
  constructor(title: string, message: string, status: HttpStatus, details?: string) {
    const body: UserFacingError = { title, message, statusCode: status };
    if (details) body.details = details;
    super(body, status);
  }
}

export class ValidationFailure extends AppError {
  constructor(message: string, details?: string[]) {
    super(
      'That request could not be understood',
      message,
      HttpStatus.BAD_REQUEST,
      details?.join('\n'),
    );
  }
}

export class NotFound extends AppError {
  constructor(what: string) {
    super('Not found', `${what} could not be found.`, HttpStatus.NOT_FOUND);
  }
}

export class Forbidden extends AppError {
  constructor(message: string) {
    super('Request refused', message, HttpStatus.FORBIDDEN);
  }
}

export class Conflict extends AppError {
  constructor(message: string) {
    super('That is not possible right now', message, HttpStatus.CONFLICT);
  }
}
