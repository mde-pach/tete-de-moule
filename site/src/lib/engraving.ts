/**
 * Engraving, in the browser, through Verovio compiled to WebAssembly.
 *
 * The module weighs a few megabytes, so it is imported lazily: the landing page
 * stays light and the engraver only loads once a file has been dropped.
 */
let toolkitPromise: Promise<VerovioToolkitLike> | null = null;

interface VerovioToolkitLike {
  setOptions(options: Record<string, unknown>): void;
  loadData(data: string): boolean;
  getPageCount(): number;
  renderToSVG(page: number): string;
  getLog(): string;
}

export const A4_PORTRAIT = {
  pageWidth: 2100,
  pageHeight: 2970,
  pageMarginTop: 100,
  pageMarginBottom: 100,
  pageMarginLeft: 100,
  pageMarginRight: 100,
} as const;

async function loadToolkit(): Promise<VerovioToolkitLike> {
  if (!toolkitPromise) {
    toolkitPromise = (async () => {
      const [{ default: createModule }, { VerovioToolkit }] = await Promise.all([
        import("verovio/wasm"),
        import("verovio/esm"),
      ]);
      const module = await createModule();
      return new VerovioToolkit(module) as unknown as VerovioToolkitLike;
    })();
  }
  return toolkitPromise;
}

export interface EngraveOptions {
  readonly scale?: number;
  readonly showMeasureNumbers?: boolean;
  readonly lyricSize?: number;
}

export async function engrave(
  musicXml: string,
  options: EngraveOptions = {},
): Promise<string[]> {
  const toolkit = await loadToolkit();
  toolkit.setOptions({
    ...A4_PORTRAIT,
    scale: options.scale ?? 38,
    adjustPageHeight: false,
    breaks: "auto",
    mnumInterval: options.showMeasureNumbers === false ? 0 : 1,
    lyricSize: options.lyricSize ?? 4,
    spacingStaff: 20,
    spacingSystem: 10,
    footer: "none",
    font: "Leipzig",
  });
  if (!toolkit.loadData(musicXml)) {
    throw new Error("La gravure de la partition a échoué.");
  }
  const pages: string[] = [];
  for (let page = 1; page <= toolkit.getPageCount(); page += 1) {
    pages.push(emphasiseAnnotations(toolkit.renderToSVG(page)));
  }
  return pages;
}

const DIGITS_ONLY = /^[0-9-]+$/;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Fingerings are set in bold and note names in grey italics, so the eye can
 * pick out one layer at a time. Only lyric verses are touched; measure numbers
 * are digits too and must stay as they are.
 */
function emphasiseAnnotations(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  for (const group of Array.from(document.getElementsByTagNameNS(SVG_NAMESPACE, "g"))) {
    if (group.getAttribute("class") !== "verse") continue;
    for (const span of Array.from(group.getElementsByTagNameNS(SVG_NAMESPACE, "tspan"))) {
      if (!span.getAttribute("font-size")) continue;
      const content = (span.textContent ?? "").trim();
      if (!content) continue;
      if (DIGITS_ONLY.test(content)) {
        span.setAttribute("font-weight", "bold");
      } else {
        span.setAttribute("fill", "#8a8580");
        span.setAttribute("font-style", "italic");
      }
    }
  }
  return new XMLSerializer().serializeToString(document);
}
