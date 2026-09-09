import type { PartieMsc } from './mscz';
import { INSTRUMENTS, instrumentParId, type Instrument, type Lecture } from './instruments';

/**
 * Préférences.
 *
 * On change rarement d'instrument : une fois choisi, il est retenu et l'on
 * n'a plus à y revenir. Même chose pour la clé de lecture et le nombre de
 * pistons, qui sont des propriétés de la personne, pas du morceau.
 */

const CLE = 'tete-de-moule.preferences.v1';

export interface Preferences {
  instrument: string;
  lecture: string;
  pistons: number;
  doigtes: boolean;
  nomsDeNotes: boolean;
}

export const PREFERENCES_PAR_DEFAUT: Preferences = {
  instrument: 'euphonium',
  lecture: 'fa-sib',
  pistons: 3,
  doigtes: true,
  nomsDeNotes: true,
};

export function lirePreferences(): Preferences | null {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return null;
    const lues = { ...PREFERENCES_PAR_DEFAUT, ...(JSON.parse(brut) as Partial<Preferences>) };
    // Un identifiant peut avoir disparu entre deux versions du catalogue.
    const instrument = instrumentParId(lues.instrument);
    if (!instrument) return null;
    if (!instrument.lectures.some((l) => l.id === lues.lecture)) {
      lues.lecture = instrument.lectures[0]!.id;
    }
    if (!instrument.pistons.includes(lues.pistons)) lues.pistons = instrument.pistons[0]!;
    return lues;
  } catch {
    return null;
  }
}

export function ecrirePreferences(p: Preferences): void {
  try {
    localStorage.setItem(CLE, JSON.stringify(p));
  } catch {
    // Navigation privée, quota plein : on continue sans mémoriser.
  }
}

export function oublierPreferences(): void {
  try {
    localStorage.removeItem(CLE);
  } catch {
    /* sans effet */
  }
}

/**
 * Lecture la plus probable pour une partie donnée : celle qui correspond à
 * l'écriture déjà présente dans le fichier. Si la partie est écrite en clé de
 * fa transposée en Si bémol, on la laisse ainsi plutôt que de la déplacer.
 */
export function lectureProbable(instrument: Instrument, partie: PartieMsc): Lecture {
  const cleDuFichier = partie.cle === 'F' ? 'fa' : 'sol';
  const exacte = instrument.lectures.find(
    (l) => l.transposition === partie.transposition && l.cle === cleDuFichier,
  );
  if (exacte) return exacte;
  const memeCle = instrument.lectures.find((l) => l.cle === cleDuFichier);
  return memeCle ?? instrument.lectures[0]!;
}

/**
 * Partie la plus probable pour un instrument donné.
 *
 * On note chaque partie sur trois critères : le nom, l'ambitus réel comparé à
 * celui que l'instrument peut produire, et la transposition déclarée. Les
 * percussions sont écartées d'office.
 */
export function partieProbable(instrument: Instrument, parties: PartieMsc[]): PartieMsc | null {
  const candidates = parties.filter((p) => p.cle !== 'PERC' && p.nombreDeNotes > 0);
  if (!candidates.length) return null;

  const motsParInstrument: Record<string, string[]> = {
    euphonium: ['euphonium', 'basse', 'saxhorn basse', 'baryton', 'tuba'],
    baryton: ['baryton', 'euphonium', 'basse'],
    soubassophone: ['soubasse', 'sousaphone', 'soubassophone', 'tuba', 'contrebasse', 'basse'],
    'tuba-mib': ['tuba', 'contrebasse', 'basse'],
    trompette: ['trompette', 'trumpet', 'cornet'],
    bugle: ['bugle', 'flugel', 'trompette'],
    'saxhorn-alto': ['alto', 'saxhorn alto', 'peck'],
  };
  const mots = motsParInstrument[instrument.id] ?? [];

  // Ambitus réellement atteignable : du 2e harmonique au plus aigu retenu.
  const grave = Math.round(instrument.fondamentale + 12) - 6;
  const aigu = Math.round(
    instrument.fondamentale + 12 * Math.log2(Math.max(...instrument.partiels)),
  );

  let meilleure = candidates[0]!;
  let meilleurScore = -Infinity;
  for (const partie of candidates) {
    let score = 0;
    const nom = `${partie.nom} ${partie.nomLong}`.toLowerCase();
    const rang = mots.findIndex((m) => nom.includes(m));
    if (rang >= 0) score += 60 - rang * 10;
    if (partie.ambitus) {
      const [bas, haut] = partie.ambitus;
      if (bas >= grave && haut <= aigu) score += 40;
      else score -= Math.abs(bas - grave) + Math.abs(haut - aigu);
    }
    if (instrument.lectures.some((l) => l.transposition === partie.transposition)) score += 10;
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleure = partie;
    }
  }
  return meilleure;
}

export { INSTRUMENTS };
