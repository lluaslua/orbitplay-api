import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError } from '../../contracts';

/**
 * Todo erro sai no formato `ApiError` — `{ message, code?, fields? }` —, que é
 * o que o interceptor do axios no app lê e as telas mostram. O corpo padrão do
 * Nest (`statusCode`, `error`, `message` em lista) não passa daqui.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(toApiError(exception));
      return;
    }

    // Erros do body-parser (JSON inválido, corpo grande) vêm com `status` e não são HttpException.
    const status = (exception as { status?: number; type?: string } | null)?.status;
    const tipo = (exception as { type?: string } | null)?.type;
    if (typeof status === 'number' && status >= 400 && status < 500 && typeof tipo === 'string') {
      const body: ApiError =
        status === 413
          ? { message: 'O conteúdo enviado é grande demais.', code: 'PAYLOAD_TOO_LARGE' }
          : { message: 'Requisição inválida.' };
      response.status(status).json(body);
      return;
    }

    // Só o servidor vê o detalhe; o cliente recebe a mensagem genérica.
    this.logger.error(exception);
    const body: ApiError = { message: 'Não foi possível concluir a operação.' };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}

function toApiError(exception: HttpException): ApiError {
  // O multer recusa o arquivo grande com mensagem em inglês.
  if (exception.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE) {
    return { message: 'O arquivo passa do tamanho máximo permitido.', code: 'FILE_TOO_LARGE' };
  }

  const body = exception.getResponse();
  if (typeof body === 'string') return { message: body };

  const { message, code, fields } = body as {
    message?: string | string[];
    code?: string;
    fields?: Record<string, string>;
  };

  return {
    message: (Array.isArray(message) ? message[0] : message) ?? exception.message,
    ...(code ? { code } : {}),
    ...(fields ? { fields } : {}),
  };
}
