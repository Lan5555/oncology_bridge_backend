import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class NetResponseFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const multerCode =
      exception && typeof exception === 'object' && 'code' in exception
        ? String((exception as { code?: unknown }).code)
        : '';
    const status =
      multerCode === 'LIMIT_FILE_SIZE'
        ? HttpStatus.PAYLOAD_TOO_LARGE
        : this.isMalformedJson(exception)
          ? HttpStatus.BAD_REQUEST
          : exception instanceof HttpException
            ? exception.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = this.isMalformedJson(exception)
      ? 'Malformed JSON request body'
      : exception instanceof HttpException
        ? exception.getResponse()
        : null;
    const message =
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object' && 'message' in raw
          ? (raw as any).message
          : exception instanceof Error
            ? exception.message
            : 'Unexpected server error';
    const data =
      raw && typeof raw === 'object' && 'data' in raw
        ? ((raw as { data?: unknown }).data ?? null)
        : raw && typeof raw === 'object'
          ? Object.fromEntries(
              Object.entries(raw).filter(
                ([key]) => key !== 'message' && key !== 'statusCode',
              ),
            )
          : null;
    response.status(status).json({
      success: false,
      message: Array.isArray(message) ? message.join('; ') : String(message),
      data,
    });
  }

  private isMalformedJson(exception: unknown): boolean {
    return (
      !!exception &&
      typeof exception === 'object' &&
      'type' in exception &&
      (exception as { type?: unknown }).type === 'entity.parse.failed'
    );
  }
}
