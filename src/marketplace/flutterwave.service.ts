import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { paymentCallback } from './payment-callback';
import type { VerifiedPayment } from './paystack.service';

@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);

  constructor(private readonly config: ConfigService) {}

  private secret() {
    const key = this.config.get<string>('FLUTTERWAVE_SECRET_KEY');
    if (!key)
      throw new ServiceUnavailableException('Flutterwave is not configured.');
    return key;
  }
  assertConfigured() {
    this.secret();
    if (!this.config.get<string>('FLUTTERWAVE_SECRET_HASH'))
      throw new ServiceUnavailableException(
        'Flutterwave webhook secret is not configured.',
      );
    paymentCallback(this.config, 'configuration-check');
  }
  private async request(
    path: string,
    body?: object,
  ): Promise<Record<string, unknown>> {
    const key = this.secret();
    const signal = AbortSignal.timeout(15000);
    let failure = 'could not connect to Flutterwave';
    try {
      const response = await fetch(`https://api.flutterwave.com/v3${path}`, {
        method: body ? 'POST' : 'GET',
        signal,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      failure = `Flutterwave returned HTTP ${response.status}`;
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }

      failure = 'Flutterwave returned invalid JSON';
      const result = (await response.json()) as {
        status?: unknown;
        data?: unknown;
      } | null;
      failure = 'Flutterwave did not confirm the transaction in its response';
      if (
        result?.status !== 'success' ||
        !result.data ||
        typeof result.data !== 'object' ||
        Array.isArray(result.data)
      )
        throw new Error();
      return result.data as Record<string, unknown>;
    } catch {
      if (body) {
        const reason = signal.aborted ? 'the request timed out' : failure;
        this.logger.warn(`Flutterwave checkout request failed. ${reason}.`);
      }
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
    // The backend sets the hosted checkout amount and verifies payment before fulfillment.
    const data = await this.request('/payments', {
      tx_ref: reference,
      amount: amount / 100,
      currency: 'NGN',
      redirect_url: paymentCallback(this.config, invoice),
      customer: { email },
    });
    const link = data.link;
    const hasLink = typeof link === 'string' && link.trim() !== '';
    const url = hasLink && URL.canParse(link) ? new URL(link) : null;
    let reason: string;
    if (!hasLink) reason = 'data.link is missing, blank, or not a string';
    else if (!url) reason = 'data.link is not an absolute URL';
    else if (url.protocol !== 'https:') reason = 'the URL does not use HTTPS';
    else if (url.username || url.password)
      reason = 'the URL embeds credentials';
    else if (url.port) reason = 'the URL uses a nonstandard HTTPS port';
    else if (
      url.hostname === 'checkout.flutterwave.com' ||
      (url.hostname === 'checkout-v2.dev-flutterwave.com' &&
        this.secret().startsWith('FLWSECK_TEST-'))
    )
      return url.toString();
    else reason = `unexpected hostname (${url.hostname.slice(0, 253)})`;

    this.logger.warn(`Flutterwave checkout link rejected. Reason: ${reason}.`);
    throw new BadGatewayException({
      message: 'Flutterwave returned an invalid checkout URL.',
      code: 'PAYMENT_INITIALIZATION_FAILED',
    });
  }
  async verify(reference: string): Promise<VerifiedPayment> {
    const data = await this.request(
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
    );
    const amount =
      typeof data.amount === 'number'
        ? data.amount
        : typeof data.amount === 'string' &&
            /^\d+(?:\.\d{1,2})?$/.test(data.amount)
          ? Number(data.amount)
          : NaN;
    const kobo = Math.round(amount * 100);
    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      Math.abs(amount * 100 - kobo) > 0.001 ||
      !Number.isSafeInteger(kobo) ||
      typeof data.status !== 'string' ||
      typeof data.currency !== 'string' ||
      typeof data.tx_ref !== 'string'
    )
      throw new BadGatewayException(
        'Flutterwave returned an invalid verification result.',
      );
    return {
      status: data.status === 'successful' ? 'success' : data.status,
      amount: kobo,
      currency: data.currency,
      reference: data.tx_ref,
    };
  }
  // Flutterwave Standard v3 uses the dashboard secret hash in verif-hash.
  authenticateWebhook(signature: string | undefined) {
    const secret = this.config.get<string>('FLUTTERWAVE_SECRET_HASH');
    if (!secret || !signature)
      throw new UnauthorizedException('Invalid payment signature.');
    const expected = Buffer.from(secret);
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
      throw new UnauthorizedException('Invalid payment signature.');
  }
}
