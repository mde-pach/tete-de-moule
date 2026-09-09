/**
 * User-facing wording. The interface is French because the band is; the code
 * around it is not. Keeping the strings here is what makes that split possible.
 */
import type { UnsupportedFeature } from "./musescore.ts";

export const UNSUPPORTED_LABELS: Record<UnsupportedFeature, string> = {
  jump: "Renvois (D.C., D.S., Coda) — la forme du morceau n'est pas reproduite",
  "grace-note": "Notes d'ornement (petites notes)",
  "extra-voice": "Deuxième voix sur la portée — seule la première est reprise",
  "clef-change": "Changement de clé en cours de morceau",
  ornament: "Trilles et ornements",
  glissando: "Glissandos",
  arpeggio: "Arpèges",
};

export function describeRange(low: number, high: number): string {
  return `${noteLabel(low)} – ${noteLabel(high)}`;
}

const PITCH_NAMES = ["Do", "Do♯", "Ré", "Mi♭", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "Si♭", "Si"];

export function noteLabel(midi: number): string {
  return `${PITCH_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
