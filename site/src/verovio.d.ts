// The Verovio package ships no type declarations for its browser entry points.
declare module "verovio/wasm" {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module "verovio/esm" {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    getPageCount(): number;
    renderToSVG(page: number): string;
    getLog(): string;
  }
}
