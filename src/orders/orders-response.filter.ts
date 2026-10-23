import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class OrdersResponseFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : null;
    const message =
      status >= 500
        ? 'Purchase order processing is temporarily unavailable. Please retry.'
        : typeof body === 'string'
          ? body
          : body && typeof body === 'object' && 'message' in body
            ? body.message
            : 'Request failed';
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        success: false,
        message: Array.isArray(message) ? message.join('; ') : String(message),
        data: null,
      });
  }
}
