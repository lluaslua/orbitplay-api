import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

/**
 * Validação global dos DTOs.
 *
 * O erro sai com `fields` — campo → primeira mensagem —, o formato de
 * `ApiError.fields`, em vez da lista solta de mensagens do Nest.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        message: 'Confira os campos destacados.',
        code: ErrorCode.VALIDATION_ERROR,
        fields: flatten(errors),
      }),
  });
}

/** Aninhados viram `budget.slots`, `questions.0.label`. */
function flatten(errors: ValidationError[], prefix = ''): Record<string, string> {
  return errors.reduce<Record<string, string>>((fields, error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const first = error.constraints && Object.values(error.constraints)[0];
    if (first) fields[path] = first;
    if (error.children?.length) Object.assign(fields, flatten(error.children, path));
    return fields;
  }, {});
}
