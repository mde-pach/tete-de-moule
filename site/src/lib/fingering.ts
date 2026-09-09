/**
 * Valve fingerings for brass instruments, derived from the harmonic series
 * rather than from a hard-coded chart.
 *
 * An open length of tubing sounds a harmonic series. Each valve lengthens the
 * tube and lowers the pitch by a fixed interval. To play a note we look for the
 * closest harmonic *above* it and press the valves that fill the gap. Picking
 * the closest harmonic means picking the shortest valve combination, which is
 * also the best in tune.
 */

/** Semitones above the fundamental for harmonics 1..12. */
const HARMONIC_OFFSETS = [0, 12, 19, 24, 28, 31, 34, 36, 38, 40, 42, 43];

/** Harmonics 7 and 11 are badly out of tune on valved brass; nobody uses them. */
const UNUSABLE_HARMONICS = new Set([7, 11]);

/** How far each valve lowers the pitch, in semitones. */
export const VALVE_DROP: Record<number, number> = { 1: 2, 2: 1, 3: 3, 4: 5 };

export interface Harmonic {
  /** Harmonic number, 1 being the fundamental (the "pedal" note). */
  readonly number: number;
  /** Concert pitch of that harmonic, as a MIDI note number. */
  readonly pitch: number;
}

export function harmonicSeries(fundamental: number): Harmonic[] {
  return HARMONIC_OFFSETS.map((offset, index) => ({
    number: index + 1,
    pitch: fundamental + offset,
  })).filter((harmonic) => !UNUSABLE_HARMONICS.has(harmonic.number));
}

/**
 * Valve combinations in conventional preference order, best first.
 *
 * The position in this list is also the number of semitones the combination
 * lowers the pitch, which `assertPreferenceOrder` checks against VALVE_DROP.
 * The order is a playing convention, not arithmetic: valve 3 alone also drops
 * three semitones but runs sharp, so players use 1-2 instead; likewise a fourth
 * valve replaces 1-3 and 1-2-3, which are the worst-tuned combinations.
 */
const PREFERENCE: Record<number, readonly string[]> = {
  3: ["0", "2", "1", "1-2", "2-3", "1-3", "1-2-3"],
  4: ["0", "2", "1", "1-2", "2-3", "4", "2-4", "1-4", "1-2-4", "2-3-4", "1-3-4", "1-2-3-4"],
};

/**
 * A slide replaces the valves: seven positions, each one semitone lower than
 * the last, so position number = semitones below the harmonic, plus one. Same
 * harmonic series, same arithmetic — only the label changes.
 */
export const SLIDE_POSITIONS: readonly string[] = ["1", "2", "3", "4", "5", "6", "7"];

/** Instruments with a slide are stored with a valve count of zero. */
export const SLIDE = 0;

function dropOf(combination: string): number {
  if (combination === "0") return 0;
  return combination
    .split("-")
    .reduce((total, valve) => total + VALVE_DROP[Number(valve)]!, 0);
}

/** Guards against a typo in PREFERENCE: index must equal the semitone drop. */
export function assertPreferenceOrder(): void {
  for (const [valveCount, combinations] of Object.entries(PREFERENCE)) {
    combinations.forEach((combination, index) => {
      const drop = dropOf(combination);
      if (drop !== index) {
        throw new Error(
          `${valveCount} valves: "${combination}" drops ${drop} semitones but sits at index ${index}`,
        );
      }
    });
  }
}

export interface FingeringChoice {
  /** Valve combination ("0", "1", "1-3") or slide position ("1".."7"). */
  readonly valves: string;
  /** Harmonic the note sits on. */
  readonly harmonic: number;
}

/**
 * Fingering for a note given as a *concert* (sounding) MIDI pitch. Working from
 * concert pitch rather than from the written note means the answer stays right
 * whatever clef or transposition the part is displayed in.
 */
export function fingeringFor(
  concertPitch: number,
  fundamental: number,
  valveCount: number,
): FingeringChoice | null {
  const combinations =
    valveCount === SLIDE ? SLIDE_POSITIONS : (PREFERENCE[valveCount] ?? PREFERENCE[3]!);
  let best: FingeringChoice | null = null;
  let bestDrop = Infinity;

  for (const harmonic of harmonicSeries(fundamental)) {
    const drop = harmonic.pitch - concertPitch;
    if (drop < 0 || drop >= bestDrop) continue;
    const valves = combinations[drop];
    if (valves === undefined) continue;
    best = { valves, harmonic: harmonic.number };
    bestDrop = drop;
  }
  return best;
}

/** Every note reachable between two concert pitches, with its fingering. */
export function fingeringChart(
  lowest: number,
  highest: number,
  fundamental: number,
  valveCount: number,
): { pitch: number; fingering: FingeringChoice }[] {
  const chart: { pitch: number; fingering: FingeringChoice }[] = [];
  for (let pitch = lowest; pitch <= highest; pitch += 1) {
    const fingering = fingeringFor(pitch, fundamental, valveCount);
    if (fingering) chart.push({ pitch, fingering });
  }
  return chart;
}
