/**
 * Export PDF.
 *
 * Le PDF ne contient que la partition : pas de page de garde, pas de légende,
 * pas de tableau de doigtés. Ce qui est à l'écran est ce qui s'imprime.
 *
 * Chaque page SVG est rendue dans un canvas puis posée dans le PDF. On passe
 * par le canvas plutôt que par une conversion SVG vectorielle parce que le
 * rendu obtenu est exactement celui de l'aperçu, sur tous les navigateurs, sans
 * dépendre du support des polices ou des symboles SMuFL. À 300 points par
 * pouce, l'impression est nette sur un pupitre comme sur une imprimante.
 */

const A4_POINTS = { largeur: 595.28, hauteur: 841.89 };
const PPP = 300;

/** Rend un SVG dans un canvas à la résolution demandée. */
async function rendre(svg: string, largeurPx: number, hauteurPx: number): Promise<HTMLCanvasElement> {
  // Le SVG de Verovio est autonome (glyphes inclus), il peut donc être chargé
  // comme une image sans requête réseau.
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.width = largeurPx;
    image.height = hauteurPx;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Le rendu de la page n'a pas abouti."));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = largeurPx;
    canvas.height = hauteurPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Le navigateur n'a pas fourni de contexte de dessin.");
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, largeurPx, hauteurPx);
    ctx.drawImage(image, 0, 0, largeurPx, hauteurPx);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface OptionsPdf {
  /** Nom du fichier téléchargé, sans extension. */
  nom: string;
  /** Titre inscrit dans les métadonnées du PDF. */
  titre?: string;
  /** Appelé après chaque page, pour l'indicateur de progression. */
  progression?: (faites: number, total: number) => void;
}

export async function pdfDepuisSvg(pages: string[], o: OptionsPdf): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  pdf.setProperties({ title: o.titre ?? o.nom, creator: 'Tête de Moule' });

  const largeurPx = Math.round((A4_POINTS.largeur / 72) * PPP);
  const hauteurPx = Math.round((A4_POINTS.hauteur / 72) * PPP);

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage('a4', 'portrait');
    const canvas = await rendre(pages[i]!, largeurPx, hauteurPx);
    pdf.addImage(
      canvas.toDataURL('image/jpeg', 0.92),
      'JPEG',
      0,
      0,
      A4_POINTS.largeur,
      A4_POINTS.hauteur,
      undefined,
      'FAST',
    );
    o.progression?.(i + 1, pages.length);
  }
  return pdf.output('blob');
}

export function telecharger(blob: Blob, nomDeFichier: string): void {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomDeFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Nom de fichier sûr sur tous les systèmes. */
export function nomDeFichier(...morceaux: string[]): string {
  return (
    morceaux
      .filter(Boolean)
      .join('-')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'partition'
  );
}
