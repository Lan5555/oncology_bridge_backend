/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable } from '@nestjs/common';

@Injectable()
export class CleanResponse {
  // 1. Cleans hash properties from a single entity object safely
  public static cleanPlain<T extends Record<string, any>>(
    res: T,
  ): Omit<T, 'phone_hash' | 'email_hash'> {
    const { phone_hash, email_hash, ...fresh } = res;
    return fresh;
  }

  // 2. Cleans hash and credential properties from a single entity object safely
  public static cleanWithPassword<T extends Record<string, any>>(
    res: T,
  ): Omit<T, 'phone_hash' | 'email_hash' | 'password_hash'> {
    const { phone_hash, email_hash, password_hash, ...fresh } = res;
    return fresh;
  }

  // 3. FIX: Dynamic property cleaner using programmatic key deletion
  public static cleanDynamic<T extends Record<string, any>, K extends keyof T>(
    keysToOmit: K[],
    target: T,
  ): Omit<T, K> {
    // Clone the target object to prevent mutating database cache instances
    const clonedTarget = { ...target };

    keysToOmit.forEach((key) => {
      delete clonedTarget[key];
    });

    return clonedTarget;
  }
}
