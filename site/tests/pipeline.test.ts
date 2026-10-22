/**
 * End-to-end check of the reading pipeline against a real MuseScore file.
 * Node has no DOMParser, so one is borrowed from linkedom.
 *
 * The fixture is not committed: band arrangements are copyrighted. Drop a .mscz
 * next to this file and point FIXTURE at it to run the check locally. The
 * expectations below were verified against the reference implementation.
 */
import { readFileSync, existsSync } from "node:fs";
import { DOMParser } from "linkedom";
import { assertPreferenceOrder, fingeringFor } from "../src/lib/fingering.ts";
import { findInstrument, writtenPitch } from "../src/lib/instruments.ts";
import { extractMscx, parseScore, type ScorePart } from "../src/lib/musescore.ts";
import { frenchNoteName, multiRestRuns, spell, toMusicXml } from "../src/lib/musicxml.ts";
import { describeShift, fifthsFor, transposePart } from "../src/lib/transposition.ts";

(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;

const FIXTURE = new URL("./fixture.mscz", import.meta.url);

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label}` +
      (ok ? "" : `\n     attendu ${JSON.stringify(expected)}\n     obtenu  ${JSON.stringify(actual)}`),
  );
}

// Always checked: the fingering table is self-consistent.
assertPreferenceOrder();
const euphonium = findInstrument("euphonium")!;
check(
  "doigt\u00e9s du Fa grave au Fa aigu",
  Array.from({ length: 25 }, (_, index) => fingeringFor(41 + index, euphonium.fundamental, 3)!.valves),
  [
    "1-3", "2-3", "1-2", "1", "2", "0", "1-2-3", "1-3", "2-3", "1-2", "1", "2", "0",
    "2-3", "1-2", "1", "2", "0", "1-2", "1", "2", "0", "1", "2", "0",
  ],
);
check("quatri\u00e8me piston sur le Fa grave", fingeringFor(41, euphonium.fundamental, 4)!.valves, "4");

// Always checked: moving a part for practice keeps it readable.
{
  const note = (pitch: number, tpc: number) => ({
    kind: "note" as const, pitch, tpc, durationType: "quarter", dots: 0, chordIndex: 0,
    articulations: [], hasAccidental: false, tieStart: false, tieStop: false,
    slurStart: false, slurStop: false, tuplet: null, tupletStart: false, tupletStop: false,
  });
  // Concert E♭ major (three flats): E♭3, B♭3.
  const practice: ScorePart = {
    index: 0, name: "Basse", displayName: "Basse", transposeChromatic: 0, sourceClef: "F",
    noteCount: 2, range: [51, 58],
    measures: [{
      number: 1, events: [note(51, 11), note(58, 12)], startRepeat: false, endRepeat: null,
      voltaStart: null, voltaStop: false, keyFifths: -3, time: { beats: 4, beatType: 4 }, length: null,
    }],
  };
  check("ton d'origine : partie inchang\u00e9e", transposePart(practice, 0), practice);

  const down = transposePart(practice, -2);
  const notes = down.measures[0]!.events.filter((event) => event.kind === "note");
  check("un ton plus bas : Mi\u266d devient R\u00e9\u266d",
    notes.map((event) => event.kind === "note" ? frenchNoteName(event.tpc) : ""), ["R\u00e9\u266d", "La\u266d"]);
  check("un ton plus bas : hauteurs", notes.map((event) => event.kind === "note" ? event.pitch : 0), [49, 56]);
  check("un ton plus bas : armure \u00e0 cinq b\u00e9mols", down.measures[0]!.keyFifths, -5);
  check("un ton plus bas : tessiture", down.range, [49, 56]);

  // Down a semitone from E\u266d: D major (two sharps), not E\u266d\u266d.
  check("demi-ton plus bas : R\u00e9 majeur", transposePart(practice, -1).measures[0]!.keyFifths, 2);
  // From concert C down a semitone: B major (five sharps) when read at concert
  // pitch, but read in B\u266d that would be C\u266f major (seven sharps), so C\u266d
  // concert is chosen instead and the player reads D\u266d (five flats).
  const inC: ScorePart = {
    ...practice,
    measures: [{ ...practice.measures[0]!, keyFifths: null }],
  };
  check("armure en ut", fifthsFor(inC, -1, 0), 5);
  check("armure choisie selon la lecture", fifthsFor(inC, -1, 2), -7);

  const octave = transposePart(practice, -12);
  check("une octave plus bas : m\u00eame armure", octave.measures[0]!.keyFifths, -3);
  check("une octave plus bas : orthographe", spell(11, 39), { step: "E", alter: -1, octave: 2 });
  check("libell\u00e9s", [describeShift(-2), describeShift(1), describeShift(0)], ["\u22121 ton", "+\u00bd ton", "Ton d'origine"]);
}

if (!existsSync(FIXTURE)) {
  console.log("\nPas de tests/fixture.mscz : contr\u00f4les de lecture ignor\u00e9s.");
  process.exit(failures === 0 ? 0 : 1);
}

const score = parseScore(extractMscx(readFileSync(FIXTURE)));
const part = score.parts.find((candidate) => candidate.noteCount > 0)!;

check("une partie jouable au moins", part.noteCount > 0, true);
check("des mesures", part.measures.length > 0, true);

for (const reading of euphonium.readings) {
  const xml = toMusicXml({
    part,
    instrument: euphonium,
    reading,
    valveCount: 3,
    showFingerings: true,
    showNoteNames: true,
    title: score.title,
    partLabel: part.name,
    tempoBpm: score.tempoBpm,
  });
  check(`${reading.id} : mesures`, (xml.match(/<measure /g) ?? []).length, part.measures.length);
  check(`${reading.id} : clef`, /<sign>([FG])<\/sign>/.exec(xml)?.[1], reading.clef);
}

// Sounding pitch is what drives everything, so the treble reading must be the
// bass one an octave higher, note for note.
const notes = part.measures.flatMap((measure) => measure.events).filter((event) => event.kind === "note");
const bass = euphonium.readings[0]!;
const treble = euphonium.readings[2]!;
check(
  "cl\u00e9 de sol = cl\u00e9 de fa + une octave",
  notes.map((note) => writtenPitch(note.pitch, treble.transpose)),
  notes.map((note) => writtenPitch(note.pitch, bass.transpose) + 12),
);
check(
  "noms de notes identiques dans les deux cl\u00e9s",
  notes.slice(0, 20).map((note) => frenchNoteName(note.tpc + 2) + spell(note.tpc + 2, writtenPitch(note.pitch, bass.transpose)).octave),
  notes.slice(0, 20).map((note) => frenchNoteName(note.tpc + 2) + (spell(note.tpc + 2, writtenPitch(note.pitch, treble.transpose)).octave - 1)),
);

// Empty bars must collapse the way the printed part does. Checked against the
// MuseScore-engraved reference for this fixture: runs of 6, 6 and 4 bars, and
// the lone rest carrying "Chant" left alone so its text survives.
// The bass part is the one the reference PDF was engraved from.
const bassPart = score.parts.find((candidate) => /tuba|basse/i.test(candidate.name)) ?? part;
const runs = [...multiRestRuns(bassPart.measures)].map(([index, length]) => [
  bassPart.measures[index]!.number,
  length,
]);
check("silences group\u00e9s comme sur la partition officielle", runs, [[25, 6], [62, 6], [82, 4]]);

const bassXml = toMusicXml({
  part: bassPart,
  instrument: euphonium,
  reading: bass,
  valveCount: 3,
  showFingerings: true,
  showNoteNames: true,
  title: score.title,
  partLabel: bassPart.name,
  tempoBpm: score.tempoBpm,
});
check(
  "balises multiple-rest \u00e9mises",
  (bassXml.match(/<multiple-rest>(\d+)<\/multiple-rest>/g) ?? []),
  ["<multiple-rest>6</multiple-rest>", "<multiple-rest>6</multiple-rest>", "<multiple-rest>4</multiple-rest>"],
);
check("le texte Chant survit", bassXml.includes("<words>Chant</words>"), true);

console.log(failures === 0 ? "\nTous les contr\u00f4les passent." : `\n${failures} \u00e9chec(s).`);
process.exit(failures === 0 ? 0 : 1);
