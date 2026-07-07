type HandlerResponse<T> = {
  success: boolean;
  message: string;
  data: T | null;
};
export type CoreResponse<T = object> = Promise<HandlerResponse<T | null>>;

export class ResponseHelper {
  static Success<T>(
    message: string,
    data: T | null = null,
  ): HandlerResponse<T | null> {
    return {
      success: true,
      message,
      data: data !== undefined ? data : null,
    };
  }

  static Error<T extends object>(
    message: any,
    data: T | null,
  ): HandlerResponse<T> {
    return {
      success: false,
      message:
        message && typeof message === 'object' && 'message' in message
          ? String((message as Record<string, unknown>).message)
          : String((message as string) || 'An error occurred'),
      data: data || ({} as T) || null,
    };
  }
}
