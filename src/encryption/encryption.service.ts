import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-cbc';

  private readonly key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');

  encrypt(text: string): string {
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');

    encrypted += cipher.final('hex');

    return `${iv.toString('hex')}:${encrypted}`;
  }

  decrypt(hash: string): string {
    const [ivHex, encrypted] = hash.split(':');

    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.key,
      Buffer.from(ivHex, 'hex'),
    );

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');

    decrypted += decipher.final('utf8');

    return decrypted;
  }

  hashPassword(password: string): string {
    const hash = bcrypt.hashSync(password, 10);
    return hash;
  }
  comparePassword(password: string, hash: string): boolean {
    const checkPassword = bcrypt.compareSync(password, hash);
    return checkPassword;
  }
}
