/**
 * Catalogue des instruments.
 *
 * Deux choses distinctes sont décrites ici, et il faut les garder séparées :
 *
 *  - l'ACOUSTIQUE (`fondamentale`, `partiels`, `pistons`) : elle détermine les
 *    doigtés, et ne dépend que du son réel produit, jamais de l'écriture.
 *  - les LECTURES (`lectures`) : la façon dont la partie est écrite sur le
 *    papier. Un même euphonium se lit en clé de fa non transposée, en clé de fa
 *    en Si bémol, ou en clé de sol en Si bémol. Cela ne change aucun doigté.
 */

export type Cle = 'sol' | 'fa';

export interface Lecture {
  id: string;
  nom: string;
  cle: Cle;
  /** Son réel = note écrite + transposition (en demi-tons). */
  transposition: number;
  /** Quintes à ajouter à l'armure réelle pour obtenir l'armure écrite. */
  quintes: number;
}

export interface Instrument {
  id: string;
  nom: string;
  /** Nom court, pour la pastille d'en-tête. */
  court: string;
  famille: string;
  /** Son réel du tube à vide, en MIDI (harmonique 1). */
  fondamentale: number;
  /** Numéros d'harmoniques réellement jouables. Les 7e et 11e sonnent faux. */
  partiels: number[];
  /** Nombres de pistons proposés. Le premier est la valeur par défaut. */
  pistons: number[];
  lectures: Lecture[];
}

// Lectures réutilisables ------------------------------------------------------
const FA_UT: Lecture = {
  id: 'fa-ut', nom: 'Clé de fa, non transposée', cle: 'fa', transposition: 0, quintes: 0,
};
const FA_SIB: Lecture = {
  id: 'fa-sib', nom: 'Clé de fa, en Si\u266d', cle: 'fa', transposition: -2, quintes: 2,
};
const SOL_SIB: Lecture = {
  id: 'sol-sib', nom: 'Clé de sol, en Si\u266d', cle: 'sol', transposition: -14, quintes: 2,
};
const SOL_SIB_AIGU: Lecture = {
  id: 'sol-sib-aigu', nom: 'Clé de sol, en Si\u266d', cle: 'sol', transposition: -2, quintes: 2,
};
const SOL_MIB: Lecture = {
  id: 'sol-mib', nom: 'Clé de sol, en Mi\u266d', cle: 'sol', transposition: -9, quintes: 3,
};

/** Harmoniques exploitables sur un cuivre : ni le 7e ni le 11e, faux par nature. */
const PARTIELS_LARGES = [2, 3, 4, 5, 6, 8, 9, 10, 12];
const PARTIELS_MOYENS = [2, 3, 4, 5, 6, 8];
const PARTIELS_COURTS = [2, 3, 4, 5, 6];

export const INSTRUMENTS: Instrument[] = [
  {
    id: 'euphonium',
    nom: 'Euphonium / saxhorn basse en Si\u266d',
    court: 'Euphonium',
    famille: 'Basses',
    fondamentale: 34,
    partiels: PARTIELS_LARGES,
    pistons: [3, 4],
    lectures: [FA_SIB, FA_UT, SOL_SIB],
  },
  {
    id: 'baryton',
    nom: 'Saxhorn baryton en Si\u266d',
    court: 'Baryton',
    famille: 'Basses',
    fondamentale: 34,
    partiels: PARTIELS_LARGES,
    pistons: [3, 4],
    lectures: [FA_SIB, FA_UT, SOL_SIB],
  },
  {
    id: 'soubassophone',
    nom: 'Soubassophone / tuba en Si\u266d',
    court: 'Soubasse',
    famille: 'Basses',
    fondamentale: 22,
    partiels: PARTIELS_LARGES,
    pistons: [3, 4],
    lectures: [FA_UT, FA_SIB, SOL_SIB],
  },
  {
    id: 'tuba-mib',
    nom: 'Tuba en Mi\u266d',
    court: 'Tuba Mi\u266d',
    famille: 'Basses',
    fondamentale: 27,
    partiels: PARTIELS_LARGES,
    pistons: [3, 4],
    lectures: [FA_UT, SOL_MIB],
  },
  {
    id: 'trompette',
    nom: 'Trompette en Si\u266d',
    court: 'Trompette',
    famille: 'Aigus',
    fondamentale: 46,
    partiels: PARTIELS_MOYENS,
    pistons: [3],
    lectures: [SOL_SIB_AIGU],
  },
  {
    id: 'bugle',
    nom: 'Bugle en Si\u266d',
    court: 'Bugle',
    famille: 'Aigus',
    fondamentale: 46,
    partiels: PARTIELS_COURTS,
    pistons: [3],
    lectures: [SOL_SIB_AIGU],
  },
  {
    id: 'saxhorn-alto',
    nom: 'Saxhorn alto en Mi\u266d',
    court: 'Alto',
    famille: 'Aigus',
    fondamentale: 39,
    partiels: PARTIELS_MOYENS,
    pistons: [3],
    lectures: [SOL_MIB],
  },
];

export function instrumentParId(id: string): Instrument | undefined {
  return INSTRUMENTS.find((i) => i.id === id);
}

export function lectureParId(instrument: Instrument, id: string): Lecture | undefined {
  return instrument.lectures.find((l) => l.id === id);
}
