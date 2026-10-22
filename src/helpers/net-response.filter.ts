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
    const inactiveMedicine = this.isInactiveMedicineWrite(exception);
    const status = inactiveMedicine
      ? HttpStatus.CONFLICT
      : multerCode === 'LIMIT_FILE_SIZE'
        ? HttpStatus.PAYLOAD_TOO_LARGE
        : this.isMalformedJson(exception)
          ? HttpStatus.BAD_REQUEST
          : exception instanceof HttpException
            ? exception.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = inactiveMedicine
      ? 'Deleted or missing medicine cannot be used for stock intake or transfers'
      : this.isMalformedJson(exception)
        ? 'Malformed JSON request body'
        : exception instanceof HttpException
          ? exception.getResponse()
          : null;
    const message: unknown =
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object' && 'message' in raw
          ? raw.message
          : exception instanceof Error
            ? exception.message
            : 'Unexpected server error';
    const data =
      raw && typeof raw === 'object' && 'data' in raw
        ? ((raw as { data?: unknown }).data ?? null)
        : raw && typeof raw === 'object'
          ? Object.fromEntries(
              Object.entries(raw).filter(
                ([key]) =>
                  key !== 'message' && key !== 'statusCode' && key !== 'error',
              ),
            )
          : null;
    response.status(status).json({
      success: false,
      message: Array.isArray(message) ? message.join('; ') : String(message),
      data:
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        !Object.keys(data).length
          ? null
          : data,
      code:
        raw && typeof raw === 'object' && 'code' in raw
          ? String(raw.code)
          : `HTTP_${status}`,
    });
  }

  private isInactiveMedicineWrite(exception: unknown): boolean {
    if (!exception || typeof exception !== 'object') return false;
    const error = exception as {
      constraint?: string;
      driverError?: { constraint?: string };
    };
    return (
      (error.constraint ?? error.driverError?.constraint) ===
      'medicine_active_required'
    );
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
