/**
 * Turns engraved pages into a downloadable PDF.
 *
 * Vector output is attempted first, which keeps the file small and sharp at any
 * zoom. Should the converter choke on a page, that page falls back to a
 * high-resolution bitmap: a slightly heavier file beats no file at all.
 */
const A4_POINTS = { width: 595.28, height: 841.89 } as const;
const RASTER_SCALE = 3;

export type PdfMode = "vector" | "raster";

export interface PdfResult {
  readonly blob: Blob;
  readonly mode: PdfMode;
}

export async function pagesToPdf(svgPages: string[]): Promise<PdfResult> {
  const { jsPDF } = await import("jspdf");
  const document_ = new jsPDF({ unit: "pt", format: "a4", compress: true });
  let mode: PdfMode = "vector";

  let svgToPdf: typeof import("svg2pdf.js").svg2pdf | null = null;
  try {
    ({ svg2pdf: svgToPdf } = await import("svg2pdf.js"));
  } catch {
    svgToPdf = null;
  }

  for (const [index, svg] of svgPages.entries()) {
    if (index > 0) document_.addPage("a4", "portrait");
    const element = parseSvg(svg);
    let drawn = false;
    if (svgToPdf) {
      try {
        await svgToPdf(element, document_, {
          x: 0,
          y: 0,
          width: A4_POINTS.width,
          height: A4_POINTS.height,
        });
        drawn = true;
      } catch {
        drawn = false;
      }
    }
    if (!drawn) {
      mode = "raster";
      const dataUrl = await rasterise(svg);
      document_.addImage(dataUrl, "PNG", 0, 0, A4_POINTS.width, A4_POINTS.height);
    }
  }

  return { blob: document_.output("blob"), mode };
}

function parseSvg(svg: string): Element {
  const holder = document.createElement("div");
  holder.innerHTML = svg;
  const element = holder.querySelector("svg");
  if (!element) throw new Error("Page illisible.");
  element.setAttribute("width", String(A4_POINTS.width));
  element.setAttribute("height", String(A4_POINTS.height));
  return element;
}

async function rasterise(svg: string): Promise<string> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(A4_POINTS.width * RASTER_SCALE);
    canvas.height = Math.round(A4_POINTS.height * RASTER_SCALE);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas indisponible.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Rendu de la page impossible."));
    image.src = url;
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
