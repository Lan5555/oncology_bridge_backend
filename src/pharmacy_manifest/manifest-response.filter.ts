import {
  ArgumentsHost,
  Catch,
  HttpException,
  InternalServerErrorException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { NetResponseFilter } from '../helpers/net-response.filter';

@Catch()
export class ManifestResponseFilter extends NetResponseFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof HttpException && exception.getStatus() === 413)
      return super.catch(
        new PayloadTooLargeException(
          'The delivery file is too large. Use a file within the upload size limit.',
        ),
        host,
      );
    return super.catch(
      exception instanceof HttpException
        ? exception
        : new InternalServerErrorException(
            'The delivery request could not be completed. Check saved deliveries by reference before retrying.',
          ),
      host,
    );
  }
}
