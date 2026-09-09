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
import { extractMscx, parseScore } from "../src/lib/musescore.ts";
import { frenchNoteName, multiRestRuns, spell, toMusicXml } from "../src/lib/musicxml.ts";

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
