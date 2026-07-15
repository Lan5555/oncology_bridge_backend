type ErrorDetails = {
  name?: string;
  stack?: string;
  code?: string | number;
  cause?: unknown;
  errors?: unknown;
};
type HandlerResponse<T> = {
  success: boolean;
  message: string;
  data: T | null;
  error?: ErrorDetails;
};

export type CoreResponse<T = object> = Promise<HandlerResponse<T>>;

export class ResponseHelper {
  static Success<T>(
    message: string,
    data: T | null = null,
  ): HandlerResponse<T> {
    return {
      success: true,
      message,
      data,
    };
  }

  static Error<T>(error: unknown, data: T | null = null): HandlerResponse<T> {
    let message = 'An unexpected error occurred';
    let details: ErrorDetails = {};

    if (error instanceof Error) {
      message = error.message;

      details = {
        name: error.name,
        stack: error.stack,
        cause: error.cause,
      };
    } else if (typeof error === 'object' && error !== null) {
      const err = error as Record<string, unknown>;

      message =
        typeof err.message === 'string'
          ? err.message
          : 'An unexpected error occurred';

      details = {
        name: typeof err.name === 'string' ? err.name : undefined,
        code:
          typeof err.code === 'string' || typeof err.code === 'number'
            ? err.code
            : undefined,
        stack: typeof err.stack === 'string' ? err.stack : undefined,
        errors: err.errors,
      };
    } else if (typeof error === 'string') {
      message = error;
    }

    return {
      success: false,
      message,
      data,
      error: details,
    };
  }
}
