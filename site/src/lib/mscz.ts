import { unzipSync, strFromU8 } from 'fflate';

/**
 * Lecture d'un fichier MuseScore (.mscz).
 *
 * Un .mscz est une archive zip contenant un .mscx, qui est du XML. Pour chaque
 * note MuseScore stocke `pitch` (la hauteur RÉELLE, en MIDI) et `tpc`
 * (l'orthographe réelle). C'est sur ces deux valeurs qu'on travaille : elles
 * sont indépendantes de la façon dont la partie a été écrite, donc on peut la
 * réécrire dans n'importe quelle clé sans se tromper.
 */

export interface NoteMsc {
  /** Hauteur réelle en MIDI. */
  hauteur: number;
  /** Orthographe réelle, au format « tpc » MuseScore. */
  tpc: number;
  /** Une altération est-elle dessinée sur la partition d'origine ? */
  alterationVisible: boolean;
}

export interface EvenementMsc {
  type: 'note' | 'silence' | 'nuance' | 'texte';
  /** Durée MuseScore : 'quarter', 'eighth', 'measure'… */
  duree?: string;
  points?: number;
  notes?: NoteMsc[];
  articulations?: string[];
  valeur?: string;
}

export interface MesureMsc {
  evenements: EvenementMsc[];
}

export interface PartieMsc {
  index: number;
  nom: string;
  nomLong: string;
  /** Transposition déclarée dans le fichier, en demi-tons. */
  transposition: number;
  cle: string;
  /** Armure réelle, en nombre de quintes (-3 = trois bémols). */
  armure: number;
  chiffrage: { haut: number; bas: number };
  nombreDeNotes: number;
  ambitus: [number, number] | null;
  mesures: MesureMsc[];
}

export interface PartitionMsc {
  titre: string;
  tempo: number | null;
  parties: PartieMsc[];
}

function texte(el: Element | null | undefined, balise: string): string | null {
  const e = el?.querySelector(`:scope > ${balise}`);
  return e ? (e.textContent ?? '').trim() : null;
}

function nombre(el: Element | null | undefined, balise: string, defaut: number): number {
  const t = texte(el, balise);
  const n = t === null ? NaN : Number(t);
  return Number.isFinite(n) ? n : defaut;
}

/** Extrait le .mscx d'une archive .mscz. */
export function extraireMscx(archive: Uint8Array): string {
  const fichiers = unzipSync(archive);
  const nom = Object.keys(fichiers).find((f) => f.endsWith('.mscx'));
  if (!nom) throw new Error("Ce fichier ne contient pas de partition MuseScore (.mscx).");
  return strFromU8(fichiers[nom]!);
}

export function lireMscx(xml: string): PartitionMsc {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('La partition est illisible : le XML interne est corrompu.');
  }
  const score = doc.querySelector('museScore > Score');
  if (!score) throw new Error("Ce fichier n'a pas la structure d'une partition MuseScore.");

  const titre =
    [...score.querySelectorAll('Text')].find((t) => texte(t, 'style') === 'title')
      ?.querySelector(':scope > text')?.textContent?.trim() ||
    [...score.querySelectorAll(':scope > metaTag')]
      .find((m) => m.getAttribute('name') === 'workTitle')?.textContent?.trim() ||
    '';

  const tempoEl = score.querySelector('Staff Measure voice > Tempo > tempo');
  const tempo = tempoEl ? Math.round(Number(tempoEl.textContent) * 60) : null;

  const partsEl = [...score.querySelectorAll(':scope > Part')];
  const stavesEl = [...score.querySelectorAll(':scope > Staff')];

  const parties: PartieMsc[] = partsEl.map((part, i) => {
    const staff = stavesEl[i];
    const instrument = part.querySelector(':scope > Instrument');
    const mesures: MesureMsc[] = [];
    let armure = 0;
    let chiffrage = { haut: 4, bas: 4 };
    const hauteurs: number[] = [];

    for (const mesureEl of staff ? [...staff.querySelectorAll(':scope > Measure')] : []) {
      const evenements: EvenementMsc[] = [];
      const voix = mesureEl.querySelector(':scope > voice');
      for (const el of voix ? [...voix.children] : []) {
        switch (el.tagName) {
          case 'KeySig':
            armure = nombre(el, 'concertKey', nombre(el, 'accidental', 0));
            break;
          case 'TimeSig':
            chiffrage = { haut: nombre(el, 'sigN', 4), bas: nombre(el, 'sigD', 4) };
            break;
          case 'Dynamic':
            evenements.push({ type: 'nuance', valeur: texte(el, 'subtype') ?? 'mf' });
            break;
          case 'StaffText': {
            const t = el.querySelector(':scope > text')?.textContent?.trim();
            if (t) evenements.push({ type: 'texte', valeur: t });
            break;
          }
          case 'Rest':
            evenements.push({
              type: 'silence',
              duree: texte(el, 'durationType') ?? 'quarter',
              points: nombre(el, 'dots', 0),
            });
            break;
          case 'Chord': {
            const notes: NoteMsc[] = [...el.querySelectorAll(':scope > Note')].map((n) => {
              const hauteur = nombre(n, 'pitch', 60);
              hauteurs.push(hauteur);
              return {
                hauteur,
                tpc: nombre(n, 'tpc', 14),
                alterationVisible: n.querySelector(':scope > Accidental') !== null,
              };
            });
            evenements.push({
              type: 'note',
              duree: texte(el, 'durationType') ?? 'quarter',
              points: nombre(el, 'dots', 0),
              notes,
              articulations: [...el.querySelectorAll(':scope > Articulation')]
                .map((a) => texte(a, 'subtype') ?? '')
                .filter(Boolean),
            });
            break;
          }
        }
      }
      mesures.push({ evenements });
    }

    const nom = texte(part, 'trackName') || texte(instrument, 'longName') || `Partie ${i + 1}`;
    return {
      index: i,
      nom,
      nomLong: texte(instrument, 'longName') || nom,
      transposition: nombre(instrument, 'transposeChromatic', 0),
      cle: texte(instrument, 'clef') || texte(part.querySelector(':scope > Staff'), 'defaultClef') || 'G',
      armure,
      chiffrage,
      nombreDeNotes: hauteurs.length,
      ambitus: hauteurs.length ? [Math.min(...hauteurs), Math.max(...hauteurs)] : null,
      mesures,
    };
  });

  return { titre, tempo, parties };
}

export function lireMscz(archive: Uint8Array): PartitionMsc {
  return lireMscx(extraireMscx(archive));
}
