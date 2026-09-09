/// <reference types="astro/client" />

// Verovio est distribué sans types : on déclare le strict nécessaire.
declare module 'verovio/wasm' {
  const creerModule: (options?: Record<string, unknown>) => Promise<unknown>;
  export default creerModule;
}

declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    getPageCount(): number;
    renderToSVG(page: number): string;
    getVersion(): string;
  }
}
