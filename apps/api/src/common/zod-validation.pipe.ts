import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';
import { ValidationFailure } from './errors';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        const first = error.issues[0];
        const field = first?.path.join('.') || 'request';
        throw new ValidationFailure(
          `${field}: ${first?.message ?? 'is invalid'}`,
          error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`),
        );
      }
      throw error;
    }
  }
}

export function zodPipe(schema: ZodSchema): ZodValidationPipe {
  return new ZodValidationPipe(schema);
}
