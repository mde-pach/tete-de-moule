/**
 * Instrument catalogue.
 *
 * Two things are kept deliberately separate:
 *
 *  - the *acoustics* (`fundamental`, `valveCount`), which decide the fingerings
 *    and depend only on the length of tubing;
 *  - the *reading* (`clef`, `transpose`), which decides how the part is written
 *    on the page.
 *
 * They are independent: the same euphonium fingerings apply whether the part is
 * printed in bass clef or in treble clef. Keeping them apart is what stops the
 * classic octave mistake, where treble-clef notation is applied with the
 * trumpet's transposition instead of the euphonium's.
 */

export type ClefSign = "F" | "G";

export interface Transposition {
  /** Sounding pitch = written pitch + chromatic (+ 12 * octaveChange). */
  readonly chromatic: number;
  readonly diatonic: number;
  readonly octaveChange: number;
}

export interface Reading {
  readonly id: string;
  /** Shown in the interface, in French. */
  readonly label: string;
  readonly clef: ClefSign;
  readonly transpose: Transposition;
}

export interface Instrument {
  readonly id: string;
  /** Shown in the interface, in French. */
  readonly label: string;
  readonly family: string;
  /** Concert MIDI pitch of the first harmonic of the open tube. */
  readonly fundamental: number;
  readonly valveCounts: readonly number[];
  readonly readings: readonly Reading[];
  /** Typical sounding range, used to guess which part belongs to the player. */
  readonly comfortableRange: readonly [number, number];
}

const CONCERT: Transposition = { chromatic: 0, diatonic: 0, octaveChange: 0 };
const B_FLAT: Transposition = { chromatic: -2, diatonic: -1, octaveChange: 0 };
const B_FLAT_NINTH: Transposition = { chromatic: -2, diatonic: -1, octaveChange: -1 };
const E_FLAT_SIXTH: Transposition = { chromatic: -9, diatonic: -5, octaveChange: 0 };
const E_FLAT_THIRTEENTH: Transposition = { chromatic: -9, diatonic: -5, octaveChange: -1 };

const B_FLAT_READINGS: Reading[] = [
  { id: "bass-bflat", label: "Clé de fa, transposée en Si♭", clef: "F", transpose: B_FLAT },
  { id: "bass-concert", label: "Clé de fa, en ut (son réel)", clef: "F", transpose: CONCERT },
  { id: "treble-bflat", label: "Clé de sol, en Si♭", clef: "G", transpose: B_FLAT_NINTH },
];

export const INSTRUMENTS: readonly Instrument[] = [
  {
    id: "euphonium",
    label: "Euphonium / saxhorn basse en Si♭",
    family: "Cuivres graves",
    fundamental: 34,
    valveCounts: [3, 4],
    readings: B_FLAT_READINGS,
    comfortableRange: [36, 65],
  },
  {
    id: "baritone",
    label: "Baryton en Si♭",
    family: "Cuivres graves",
    fundamental: 34,
    valveCounts: [3, 4],
    readings: B_FLAT_READINGS,
    comfortableRange: [38, 67],
  },
  {
    id: "tuba-bflat",
    label: "Tuba / sousaphone en Si♭",
    family: "Cuivres graves",
    fundamental: 22,
    valveCounts: [3, 4],
    readings: B_FLAT_READINGS,
    comfortableRange: [28, 58],
  },
  {
    id: "trumpet-bflat",
    label: "Trompette en Si♭",
    family: "Cuivres aigus",
    fundamental: 34,
    valveCounts: [3],
    readings: [
      { id: "treble-bflat", label: "Clé de sol, en Si♭", clef: "G", transpose: B_FLAT },
    ],
    comfortableRange: [52, 82],
  },
  {
    id: "flugelhorn",
    label: "Bugle en Si♭",
    family: "Cuivres aigus",
    fundamental: 34,
    valveCounts: [3],
    readings: [
      { id: "treble-bflat", label: "Clé de sol, en Si♭", clef: "G", transpose: B_FLAT },
    ],
    comfortableRange: [50, 77],
  },
  {
    id: "alto-horn",
    label: "Saxhorn alto en Mi♭",
    family: "Cuivres médiums",
    fundamental: 27,
    valveCounts: [3],
    readings: [
      { id: "treble-eflat", label: "Clé de sol, en Mi♭", clef: "G", transpose: E_FLAT_SIXTH },
      { id: "treble-eflat-low", label: "Clé de sol, en Mi♭ (octave grave)", clef: "G", transpose: E_FLAT_THIRTEENTH },
    ],
    comfortableRange: [45, 72],
  },
];

export function findInstrument(id: string): Instrument | undefined {
  return INSTRUMENTS.find((instrument) => instrument.id === id);
}

export function findReading(instrument: Instrument, id: string): Reading | undefined {
  return instrument.readings.find((reading) => reading.id === id);
}

/** Written pitch for a sounding pitch, under a given reading. */
export function writtenPitch(concertPitch: number, transpose: Transposition): number {
  return concertPitch - transpose.chromatic - 12 * transpose.octaveChange;
}

/**
 * How far the written key signature sits from the concert one, counted in
 * fifths. A B flat instrument writes two sharps further round the circle
 * (concert E flat, three flats, is written F major, one flat).
 */
export function fifthsShift(transpose: Transposition): number {
  // A transposition of -N semitones shifts the notation by the number of fifths
  // that spells that interval: the tonal-pitch-class distance.
  const FIFTHS_BY_SEMITONE: Record<number, number> = {
    0: 0, 1: -5, 2: 2, 3: -3, 4: 4, 5: -1, 6: 6, 7: 1, 8: -4, 9: 3, 10: -2, 11: 5,
  };
  const semitones = ((-transpose.chromatic % 12) + 12) % 12;
  return FIFTHS_BY_SEMITONE[semitones]!;
}
