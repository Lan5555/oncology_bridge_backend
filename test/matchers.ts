// Jest's asymmetric matchers are runtime objects, but its declarations return any.
// Keep that library boundary unknown so expectations don't leak unsafe types.
export const matchers = {
  any(constructor: unknown): unknown {
    return expect.any(constructor);
  },
  arrayContaining(values: unknown[]): unknown {
    return expect.arrayContaining(values);
  },
  objectContaining(value: unknown): unknown {
    return expect.objectContaining(value);
  },
  stringContaining(value: string): unknown {
    return expect.stringContaining(value);
  },
  stringMatching(value: string | RegExp): unknown {
    return expect.stringMatching(value);
  },
};
