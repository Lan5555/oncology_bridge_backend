import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifiedPayment {
  status: string;
  amount: number;
  currency: string;
  reference: string;
}
@Injectable()
export class PaystackService {
  constructor(private readonly config: ConfigService) {}
  private secret() {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!key)
      throw new ServiceUnavailableException('Paystack is not configured.');
    return key;
  }
  callback(reference: string) {
    const raw = this.config.get<string>('FRONTEND_ORIGIN');
    const allowed = (this.config.get<string>('CORS_ORIGIN') ?? '')
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
  assertConfigured() {
    this.secret();
    this.callback('configuration-check');
  }

  private async request(path: string, body?: object) {
    const key = this.secret();
    try {
      const response = await fetch(`https://api.paystack.co${path}`, {
        method: body ? 'POST' : 'GET',
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = (await response.json()) as {
        status?: unknown;
        data?: unknown;
      } | null;
      if (
        !response.ok ||
        result?.status !== true ||
        !result.data ||
        typeof result.data !== 'object' ||
        Array.isArray(result.data)
      )
        throw new Error();
      return result.data as Record<string, unknown>;
    } catch {
      throw new BadGatewayException({
        message:
          'Payment provider could not confirm the transaction. Please retry.',
        code: 'PAYMENT_INITIALIZATION_FAILED',
      });
    }
  }
  async initialize(
    email: string,
    amount: number,
    reference: string,
    invoice: string,
  ) {
    const data = await this.request('/transaction/initialize', {
      email,
      amount,
      reference,
      currency: 'NGN',
      callback_url: this.callback(invoice),
    });
    try {
      if (typeof data.authorization_url !== 'string') throw new Error();
      const url = new URL(data.authorization_url);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'checkout.paystack.com' ||
        url.port ||
        url.username ||
        url.password ||
        data.reference !== reference
      )
        throw new Error();
      return url.toString();
    } catch {
      throw new BadGatewayException({
        message: 'Paystack returned an invalid checkout URL.',
        code: 'PAYMENT_INITIALIZATION_FAILED',
      });
    }
  }
  async verify(reference: string): Promise<VerifiedPayment> {
    const data = await this.request(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    if (
      typeof data.status !== 'string' ||
      typeof data.amount !== 'number' ||
      typeof data.currency !== 'string' ||
      typeof data.reference !== 'string'
    )
      throw new BadGatewayException(
        'Paystack returned an invalid verification result.',
      );
    return {
      status: data.status,
      amount: data.amount,
      currency: data.currency,
      reference: data.reference,
    };
  }
  authenticateWebhook(raw: Buffer | undefined, signature: string | undefined) {
    if (!raw || !signature || !/^[a-f0-9]{128}$/i.test(signature))
      throw new UnauthorizedException('Invalid payment signature.');
    const expected = createHmac('sha512', this.secret()).update(raw).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      throw new UnauthorizedException('Invalid payment signature.');
  }
}
