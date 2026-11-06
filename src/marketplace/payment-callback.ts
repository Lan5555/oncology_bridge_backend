import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export function paymentCallback(config: ConfigService, reference: string) {
  const raw = config.get<string>('FRONTEND_ORIGIN');
  const allowed = (config.get<string>('CORS_ORIGIN') ?? '')
    .split(',')
    .map((x) => x.trim());
  try {
    const url = new URL(raw ?? '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !allowed.includes(url.origin)
    )
      throw new Error();
    return `${url.origin}/pay/${encodeURIComponent(reference)}`;
  } catch {
    throw new ServiceUnavailableException(
      'An HTTPS FRONTEND_ORIGIN included in CORS_ORIGIN is required.',
    );
  }
}
