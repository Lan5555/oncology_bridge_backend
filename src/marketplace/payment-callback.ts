import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export function paymentCallback(config: ConfigService, reference: string) {
  const raw = config.get<string>('FRONTEND_ORIGIN');
  const environment = config.get<string>('NODE_ENV') ?? 'development';
  const allowed = (config.get<string>('CORS_ORIGIN') ?? '')
    .split(',')
    .map((x) => x.trim());
  try {
    const url = new URL(raw ?? '');
    const localDevelopmentCallback =
      environment === 'development' &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !localDevelopmentCallback) ||
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
      'FRONTEND_ORIGIN must be an HTTPS origin listed in CORS_ORIGIN. Local development also accepts allowlisted HTTP loopback origins.',
    );
  }
}
