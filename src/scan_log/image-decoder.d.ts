declare module 'jpeg-js' {
  export function decode(
    buffer: Buffer,
    options?: { useTArray?: boolean; formatAsRGBA?: boolean },
  ): { data: Uint8Array; width: number; height: number };
}

declare module 'pngjs' {
  export class PNG {
    data: Uint8Array;
    width: number;
    height: number;
    static sync: {
      read(buffer: Buffer): PNG;
    };
  }
}
