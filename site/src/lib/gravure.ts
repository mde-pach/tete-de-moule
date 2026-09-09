/**
 * Gravure : MusicXML -> SVG, via Verovio (WebAssembly).
 *
 * Le module Verovio pèse plusieurs mégaoctets. Il n'est chargé qu'au moment où
 * l'on grave réellement quelque chose, jamais à l'ouverture de la page.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHIFFRES = /^[0-9\u2013-]+$/;

type Toolkit = {
  setOptions: (o: Record<string, unknown>) => void;
  loadData: (data: string) => boolean;
  getPageCount: () => number;
  renderToSVG: (page: number) => string;
};

let toolkit: Promise<Toolkit> | null = null;

export function chargerVerovio(): Promise<Toolkit> {
  toolkit ??= (async () => {
    const [{ default: creerModule }, { VerovioToolkit }] = await Promise.all([
      import('verovio/wasm'),
      import('verovio/esm'),
    ]);
    const module = await creerModule();
    return new VerovioToolkit(module) as unknown as Toolkit;
  })();
  return toolkit;
}

export interface FormatPage {
  /** Largeur et hauteur en dixièmes de millimètre (A4 = 2100 x 2970). */
  largeur: number;
  hauteur: number;
  /** Taille de la gravure. Plus la valeur est basse, plus il tient de mesures. */
  echelle: number;
}

export const A4: FormatPage = { largeur: 2100, hauteur: 2970, echelle: 38 };

function options(format: FormatPage) {
  return {
    pageWidth: format.largeur,
    pageHeight: format.hauteur,
    pageMarginTop: 100,
    pageMarginBottom: 100,
    pageMarginLeft: 100,
    pageMarginRight: 100,
    scale: format.echelle,
    adjustPageHeight: false,
    mnumInterval: 1,
    breaks: 'auto',
    lyricSize: 4,
    spacingStaff: 20,
    spacingSystem: 10,
    footer: 'none',
    font: 'Leipzig',
    svgRemoveXlink: true,
  };
}

/**
 * Les doigtés sont écrits comme premier couplet de paroles et les noms de notes
 * comme second. Verovio ne sait pas les distinguer, on le fait après coup :
 * ce qui est chiffré devient gras, le reste passe en gris italique.
 */
function habiller(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const racine = doc.documentElement;
  for (const groupe of racine.querySelectorAll('g.verse')) {
    for (const tspan of groupe.querySelectorAll('tspan[font-size]')) {
      const contenu = (tspan.textContent ?? '').trim();
      if (!contenu) continue;
      if (CHIFFRES.test(contenu)) {
        tspan.setAttribute('font-weight', '700');
      } else {
        tspan.setAttribute('fill', '#8b8496');
        tspan.setAttribute('font-style', 'italic');
      }
    }
  }
  return new XMLSerializer().serializeToString(racine);
}

/** Grave un MusicXML et renvoie une page SVG par page de partition. */
export async function graver(musicxml: string, format: FormatPage = A4): Promise<string[]> {
  const tk = await chargerVerovio();
  tk.setOptions(options(format));
  if (!tk.loadData(musicxml)) {
    throw new Error("La gravure a échoué : la partie n'a pas pu être relue.");
  }
  const pages: string[] = [];
  for (let p = 1; p <= tk.getPageCount(); p++) pages.push(habiller(tk.renderToSVG(p)));
  return pages;
}

/** Grave un extrait sur une seule ligne, hauteur ajustée au contenu. */
export async function graverExtrait(musicxml: string, largeur = 2400, echelle = 48): Promise<string> {
  const tk = await chargerVerovio();
  tk.setOptions({
    ...options({ largeur, hauteur: 1400, echelle }),
    adjustPageHeight: true,
    header: 'none',
    mnumInterval: 0,
    lyricSize: 5.4,
    spacingStaff: 26,
    pageMarginTop: 20,
    pageMarginBottom: 20,
  });
  if (!tk.loadData(musicxml)) throw new Error('Extrait non gravable.');
  const svg = habiller(tk.renderToSVG(1));
  // Verovio numérote les systèmes même quand on ne le lui demande pas.
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  for (const n of doc.documentElement.querySelectorAll('g.mNum')) n.remove();
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export { SVG_NS };
