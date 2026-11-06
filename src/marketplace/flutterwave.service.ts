import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { paymentCallback } from './payment-callback';
import type { VerifiedPayment } from './paystack.service';

@Injectable()
export class FlutterwaveService {
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
    try {
      const response = await fetch(`https://api.flutterwave.com/v3${path}`, {
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
        result?.status !== 'success' ||
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
    // Internal amounts are integer kobo; Flutterwave accepts major currency units.
    const naira = (amount / 100).toFixed(2);
    const secretHash = createHash('sha256').update(this.secret()).digest('hex');
    const payloadHash = createHash('sha256')
      .update(naira + 'NGN' + email + reference + secretHash)
      .digest('hex');
    const data = await this.request('/payments', {
      tx_ref: reference,
      amount: naira,
      currency: 'NGN',
      redirect_url: paymentCallback(this.config, invoice),
      customer: { email },
      payload_hash: payloadHash,
    });
    try {
      if (typeof data.link !== 'string') throw new Error();
      const url = new URL(data.link);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'checkout.flutterwave.com' ||
        url.port ||
        url.username ||
        url.password
      )
        throw new Error();
      return url.toString();
    } catch {
      throw new BadGatewayException({
        message: 'Flutterwave returned an invalid checkout URL.',
        code: 'PAYMENT_INITIALIZATION_FAILED',
      });
    }
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
