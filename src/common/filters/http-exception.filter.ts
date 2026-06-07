import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let code: string;
    let message: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'object' && res !== null && 'code' in res) {
        const resObj = res as Record<string, unknown>;
        code = String(resObj['code']);
        const rawMessage = resObj['message'];
        message = Array.isArray(rawMessage)
          ? rawMessage.join(', ')
          : String(rawMessage ?? exception.message);
      } else {
        code = HttpStatus[status] ?? 'UNKNOWN';
        if (typeof res === 'object' && res !== null && 'message' in res) {
          const rawMessage = (res as Record<string, unknown>)['message'];
          message = Array.isArray(rawMessage)
            ? rawMessage.join(', ')
            : String(rawMessage ?? exception.message);
        } else {
          message = typeof res === 'string' ? res : exception.message;
        }
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'INTERNAL_SERVER_ERROR';
      message = '서버 내부 오류가 발생했습니다.';
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      error: { code, message },
    });
  }
}
