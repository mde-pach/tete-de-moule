import type { Instrument } from './instruments';

/**
 * Moteur de doigtés.
 *
 * Aucune table n'est codée en dur. Le tube à vide produit une série
 * d'harmoniques ; chaque piston rallonge le tube et fait descendre la note.
 * Pour une note donnée, on cherche l'harmonique le plus proche AU-DESSUS
 * d'elle, puis la combinaison de pistons qui comble l'écart. Prendre
 * l'harmonique le plus proche revient à prendre la combinaison la plus courte,
 * donc la plus juste.
 */

/** Demi-tons de descente -> combinaison, sur trois pistons. */
const COMBOS_3: Record<number, string> = {
  0: '0', 1: '2', 2: '1', 3: '1-2', 4: '2-3', 5: '1-3', 6: '1-2-3',
};

/** Le 4e piston descend d'une quarte juste : il remplace avantageusement 1-3. */
const COMBOS_4: Record<number, string> = {
  0: '0', 1: '2', 2: '1', 3: '1-2', 4: '2-3', 5: '4', 6: '2-4',
  7: '1-4', 8: '1-2-4', 9: '2-3-4', 10: '1-3-4', 11: '1-2-3-4',
};

/** Hauteur MIDI de l'harmonique n, arrondie au demi-ton le plus proche. */
export function hauteurPartiel(fondamentale: number, n: number): number {
  return Math.round(fondamentale + 12 * Math.log2(n));
}

export function partiels(instrument: Instrument): number[] {
  return instrument.partiels.map((n) => hauteurPartiel(instrument.fondamentale, n));
}

export interface Doigte {
  /** La combinaison, par exemple "1-3". "0" signifie à vide. */
  combinaison: string;
  /** Numéro de l'harmonique utilisé, utile pour les fiches pédagogiques. */
  harmonique: number | null;
}

/**
 * Doigté d'une note à partir de sa hauteur RÉELLE (MIDI).
 * Renvoie une combinaison vide si la note est hors de portée de l'instrument.
 */
export function doigte(hauteurReelle: number, instrument: Instrument, pistons: number): Doigte {
  const table = pistons >= 4 ? COMBOS_4 : COMBOS_3;
  let meilleur: number | null = null;
  let harmonique: number | null = null;

  for (const n of instrument.partiels) {
    const ecart = hauteurPartiel(instrument.fondamentale, n) - hauteurReelle;
    const combinaison = table[ecart];
    if (combinaison !== undefined && (meilleur === null || ecart < meilleur)) {
      meilleur = ecart;
      harmonique = n;
    }
  }

  if (meilleur === null) return { combinaison: '', harmonique: null };
  return { combinaison: table[meilleur]!, harmonique };
}

// --- noms de notes ----------------------------------------------------------

/** Ordre des « tpc » MuseScore : positions sur le cycle des quintes. */
const LETTRES = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const;
const NOM_FR: Record<string, string> = {
  C: 'Do', D: 'Ré', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si',
};
const ALTERATION_FR: Record<number, string> = {
  '-2': '\u266d\u266d', '-1': '\u266d', 0: '', 1: '\u266f', 2: '\u266f\u266f',
};
const HAUTEUR_NATURELLE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

export interface NoteEcrite {
  lettre: string;
  alteration: number;
  octave: number;
  nom: string;
}

/**
 * Décompose un « tpc » MuseScore en lettre + altération.
 * tpc 13 = Fa, 14 = Do, 15 = Sol… ; retirer 7 donne un bémol, ajouter 7 un dièse.
 */
export function tpcEnLettre(tpc: number): { lettre: string; alteration: number } {
  const index = ((((tpc - 13) % 7) + 7) % 7);
  return { lettre: LETTRES[index]!, alteration: Math.floor((tpc - 13) / 7) };
}

/** Octave MusicXML cohérente avec la lettre et la hauteur écrite. */
export function octaveDe(hauteurEcrite: number, lettre: string, alteration: number): number {
  return Math.floor((hauteurEcrite - alteration - HAUTEUR_NATURELLE[lettre]!) / 12) - 1;
}

export function noteEcrite(tpcReel: number, quintes: number, hauteurEcrite: number): NoteEcrite {
  const tpc = tpcReel + quintes;
  const { lettre, alteration } = tpcEnLettre(tpc);
  return {
    lettre,
    alteration,
    octave: octaveDe(hauteurEcrite, lettre, alteration),
    nom: NOM_FR[lettre]! + (ALTERATION_FR[alteration] ?? ''),
  };
}
