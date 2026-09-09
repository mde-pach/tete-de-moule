import type { PartieMsc, PartitionMsc } from './mscz';
import type { Instrument, Lecture } from './instruments';
import { doigte, noteEcrite } from './doigtes';

/**
 * Réécriture d'une partie MuseScore en MusicXML, dans la lecture choisie.
 *
 * On repart toujours de la hauteur RÉELLE de chaque note, jamais de son
 * écriture d'origine. La lecture fournit la transposition (donc l'octave et la
 * clé) et le décalage d'armure. C'est ce qui évite le piège classique : une
 * partie d'euphonium passée en clé de sol doit monter d'une octave de plus
 * qu'une partie de trompette, sinon toutes les notes tombent sous la portée.
 */

const DIVISIONS = 480;

const DUREES: Record<string, number> = {
  whole: 4 * DIVISIONS, half: 2 * DIVISIONS, quarter: DIVISIONS,
  eighth: DIVISIONS / 2, '16th': DIVISIONS / 4, '32nd': DIVISIONS / 8,
  '64th': DIVISIONS / 16,
};

const ARTICULATIONS: Record<string, string> = {
  articStaccatoAbove: 'staccato', articStaccatoBelow: 'staccato',
  articAccentAbove: 'accent', articAccentBelow: 'accent',
  articTenutoAbove: 'tenuto', articTenutoBelow: 'tenuto',
  articMarcatoAbove: 'strong-accent', articMarcatoBelow: 'strong-accent',
};

const NOMS_ALTERATION: Record<number, string> = {
  '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'sharp-sharp',
};

export interface OptionsGravure {
  instrument: Instrument;
  lecture: Lecture;
  pistons: number;
  /** Écrire la combinaison de pistons sous chaque note. */
  doigtes: boolean;
  /** Écrire le nom de la note sous le doigté. */
  nomsDeNotes: boolean;
  titre?: string;
  nomDePartie?: string;
  tempo?: number | null;
}

function ech(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dureeEt(duree: string, points: number): { ticks: number; type: string } {
  const base = DUREES[duree] ?? DIVISIONS;
  let ticks = base;
  let ajout = base;
  for (let i = 0; i < points; i++) {
    ajout /= 2;
    ticks += ajout;
  }
  return { ticks, type: duree };
}

/** Élément <transpose> correspondant à la lecture, ou rien si non transposée. */
function transposition(lecture: Lecture): string {
  if (lecture.transposition === 0) return '';
  // On sépare l'octave du reste : -14 demi-tons = une seconde majeure + une octave.
  const octaves = Math.floor(Math.abs(lecture.transposition) / 12) * Math.sign(lecture.transposition);
  const reste = lecture.transposition - octaves * 12;
  // Un intervalle de n quintes vaut 4n degrés diatoniques, modulo l'octave.
  // 2 quintes = seconde majeure (1 degré), 3 quintes = sixte majeure (5 degrés).
  const diatonique = -((((lecture.quintes * 4) % 7) + 7) % 7);
  return [
    '<transpose>',
    `<diatonic>${diatonique}</diatonic>`,
    `<chromatic>${reste}</chromatic>`,
    octaves !== 0 ? `<octave-change>${octaves}</octave-change>` : '',
    '</transpose>',
  ].join('');
}

export function partieEnMusicXml(
  partition: PartitionMsc,
  partie: PartieMsc,
  o: OptionsGravure,
): string {
  const { lecture } = o;
  const morceaux: string[] = [];

  morceaux.push('<?xml version="1.0" encoding="UTF-8"?>');
  morceaux.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" ' +
      '"http://www.musicxml.org/dtds/partwise.dtd">',
  );
  morceaux.push('<score-partwise version="3.1">');
  morceaux.push(`<work><work-title>${ech(o.titre ?? partition.titre)}</work-title></work>`);
  morceaux.push('<part-list><score-part id="P1">');
  morceaux.push(`<part-name>${ech(o.nomDePartie ?? partie.nom)}</part-name>`);
  morceaux.push('</score-part></part-list>');
  morceaux.push('<part id="P1">');

  partie.mesures.forEach((mesure, index) => {
    morceaux.push(`<measure number="${index + 1}">`);

    if (index === 0) {
      morceaux.push('<attributes>');
      morceaux.push(`<divisions>${DIVISIONS}</divisions>`);
      morceaux.push(`<key><fifths>${partie.armure + lecture.quintes}</fifths></key>`);
      morceaux.push(
        `<time><beats>${partie.chiffrage.haut}</beats>` +
          `<beat-type>${partie.chiffrage.bas}</beat-type></time>`,
      );
      morceaux.push(
        lecture.cle === 'fa'
          ? '<clef><sign>F</sign><line>4</line></clef>'
          : '<clef><sign>G</sign><line>2</line></clef>',
      );
      morceaux.push(transposition(lecture));
      morceaux.push('</attributes>');
      if (o.tempo) {
        morceaux.push(
          '<direction placement="above"><direction-type>' +
            `<words>Noire = ${o.tempo}</words></direction-type>` +
            `<sound tempo="${o.tempo}"/></direction>`,
        );
      }
    }

    for (const ev of mesure.evenements) {
      if (ev.type === 'nuance') {
        morceaux.push(
          '<direction placement="below"><direction-type><dynamics>' +
            `<${ev.valeur}/></dynamics></direction-type></direction>`,
        );
      } else if (ev.type === 'texte') {
        morceaux.push(
          '<direction placement="above"><direction-type>' +
            `<words>${ech(ev.valeur ?? '')}</words></direction-type></direction>`,
        );
      } else if (ev.type === 'silence') {
        if (ev.duree === 'measure') {
          const ticks = (partie.chiffrage.haut / partie.chiffrage.bas) * 4 * DIVISIONS;
          morceaux.push(`<note><rest measure="yes"/><duration>${ticks}</duration></note>`);
        } else {
          const { ticks, type } = dureeEt(ev.duree ?? 'quarter', ev.points ?? 0);
          morceaux.push(
            `<note><rest/><duration>${ticks}</duration><type>${type}</type>` +
              '<dot/>'.repeat(ev.points ?? 0) +
              '</note>',
          );
        }
      } else if (ev.type === 'note') {
        const { ticks, type } = dureeEt(ev.duree ?? 'quarter', ev.points ?? 0);
        const arts = (ev.articulations ?? [])
          .map((a) => ARTICULATIONS[a])
          .filter((a): a is string => Boolean(a));

        (ev.notes ?? []).forEach((note, rang) => {
          const hauteurEcrite = note.hauteur - lecture.transposition;
          const ecrite = noteEcrite(note.tpc, lecture.quintes, hauteurEcrite);
          const bloc: string[] = ['<note>'];
          if (rang > 0) bloc.push('<chord/>');
          bloc.push('<pitch>');
          bloc.push(`<step>${ecrite.lettre}</step>`);
          if (ecrite.alteration !== 0) bloc.push(`<alter>${ecrite.alteration}</alter>`);
          bloc.push(`<octave>${ecrite.octave}</octave>`);
          bloc.push('</pitch>');
          bloc.push(`<duration>${ticks}</duration>`);
          bloc.push(`<type>${type}</type>`);
          bloc.push('<dot/>'.repeat(ev.points ?? 0));
          if (note.alterationVisible) {
            bloc.push(`<accidental>${NOMS_ALTERATION[ecrite.alteration] ?? 'natural'}</accidental>`);
          }
          if (arts.length) {
            bloc.push('<notations><articulations>');
            for (const a of arts) bloc.push(`<${a}/>`);
            bloc.push('</articulations></notations>');
          }
          if (rang === 0 && (o.doigtes || o.nomsDeNotes)) {
            let couplet = 1;
            if (o.doigtes) {
              const d = doigte(note.hauteur, o.instrument, o.pistons);
              bloc.push(
                `<lyric number="${couplet++}"><syllabic>single</syllabic>` +
                  `<text>${ech(d.combinaison || '?')}</text></lyric>`,
              );
            }
            if (o.nomsDeNotes) {
              bloc.push(
                `<lyric number="${couplet++}"><syllabic>single</syllabic>` +
                  `<text>${ech(ecrite.nom)}</text></lyric>`,
              );
            }
          }
          bloc.push('</note>');
          morceaux.push(bloc.join(''));
        });
      }
    }

    morceaux.push('</measure>');
  });

  morceaux.push('</part></score-partwise>');
  return morceaux.join('\n');
}

/** Notes distinctes de la partie, pour la fiche de doigtés à l'écran. */
export function notesDistinctes(partie: PartieMsc, lecture: Lecture) {
  const vues = new Map<string, { hauteur: number; tpc: number; occurrences: number }>();
  for (const mesure of partie.mesures) {
    for (const ev of mesure.evenements) {
      for (const note of ev.notes ?? []) {
        const cle = `${note.hauteur}:${note.tpc}`;
        const existante = vues.get(cle);
        if (existante) existante.occurrences++;
        else vues.set(cle, { hauteur: note.hauteur, tpc: note.tpc, occurrences: 1 });
      }
    }
  }
  return [...vues.values()]
    .sort((a, b) => a.hauteur - b.hauteur)
    .map((n) => ({
      ...n,
      ecrite: noteEcrite(n.tpc, lecture.quintes, n.hauteur - lecture.transposition),
    }));
}
