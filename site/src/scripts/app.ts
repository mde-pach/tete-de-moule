/**
 * Wiring for the fingering workbench.
 *
 * The flow is deliberately short: drop a file, confirm the part, get a PDF.
 * Settings are restored on load so a returning player only does step one.
 */
import { engrave } from "../lib/engraving.ts";
import {
  INSTRUMENTS,
  findInstrument,
  findReading,
  type Instrument,
  type Reading,
} from "../lib/instruments.ts";
import { UNSUPPORTED_LABELS, describeRange } from "../lib/messages.ts";
import { extractMscx, parseScore, type ParsedScore, type ScorePart } from "../lib/musescore.ts";
import { toMusicXml } from "../lib/musicxml.ts";
import { downloadBlob, pagesToPdf } from "../lib/pdf.ts";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "../lib/settings.ts";

const element = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const instrumentSelect = element<HTMLSelectElement>("instrument");
const readingSelect = element<HTMLSelectElement>("reading");
const valveSelect = element<HTMLSelectElement>("valves");
const valveField = element<HTMLElement>("valves-field");
const partSelect = element<HTMLSelectElement>("part");
const partField = element<HTMLElement>("part-field");
const partHint = element<HTMLElement>("part-hint");
const instrumentHint = element<HTMLElement>("instrument-hint");
const dropzone = element<HTMLElement>("dropzone");
const fileInput = element<HTMLInputElement>("file");
const messages = element<HTMLElement>("messages");
const actions = element<HTMLElement>("actions");
const preview = element<HTMLElement>("preview");
const pages = element<HTMLElement>("pages");
const status = element<HTMLElement>("status");
const downloadButton = element<HTMLButtonElement>("download");
const resetButton = element<HTMLButtonElement>("reset");
const fingeringToggle = element<HTMLInputElement>("show-fingerings");
const noteNameToggle = element<HTMLInputElement>("show-note-names");
const measureNumberToggle = element<HTMLInputElement>("show-measure-numbers");

let settings: Settings = loadSettings();
let score: ParsedScore | null = null;
let sourceName = "partition";
let renderedPages: string[] = [];
let renderToken = 0;

function currentInstrument(): Instrument {
  return findInstrument(settings.instrumentId) ?? INSTRUMENTS[0]!;
}

function currentReading(): Reading {
  const instrument = currentInstrument();
  return findReading(instrument, settings.readingId) ?? instrument.readings[0]!;
}

function fillReadings(): void {
  const instrument = currentInstrument();
  readingSelect.innerHTML = "";
  for (const reading of instrument.readings) {
    const option = document.createElement("option");
    option.value = reading.id;
    option.textContent = reading.label;
    readingSelect.append(option);
  }
  if (!findReading(instrument, settings.readingId)) {
    settings.readingId = instrument.readings[0]!.id;
  }
  readingSelect.value = settings.readingId;

  valveSelect.innerHTML = "";
  for (const count of instrument.valveCounts) {
    const option = document.createElement("option");
    option.value = String(count);
    option.textContent = `${count} pistons`;
    valveSelect.append(option);
  }
  if (!instrument.valveCounts.includes(settings.valveCount)) {
    settings.valveCount = instrument.valveCounts[0]!;
  }
  valveSelect.value = String(settings.valveCount);
  valveField.classList.toggle("hidden", instrument.valveCounts.length < 2);
}

/** Guesses the player's line from how well its range matches the instrument. */
function guessPart(parsed: ParsedScore, instrument: Instrument): number {
  const [low, high] = instrument.comfortableRange;
  let bestIndex = 0;
  let bestScore = -Infinity;
  parsed.parts.forEach((part, index) => {
    if (!part.range || part.noteCount === 0) return;
    const [partLow, partHigh] = part.range;
    const overlap = Math.min(high, partHigh) - Math.max(low, partLow);
    const centreDistance = Math.abs((partLow + partHigh) / 2 - (low + high) / 2);
    const score = overlap - centreDistance;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function fillParts(parsed: ParsedScore): void {
  partSelect.innerHTML = "";
  parsed.parts.forEach((part, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${part.name}${part.noteCount ? "" : " (vide)"}`;
    option.disabled = part.noteCount === 0;
    partSelect.append(option);
  });
  partSelect.value = String(guessPart(parsed, currentInstrument()));
  partField.classList.remove("hidden");
  updatePartHint();
}

function updatePartHint(): void {
  const part = selectedPart();
  partHint.textContent = part?.range
    ? `${part.noteCount} notes, de ${describeRange(part.range[0], part.range[1])} en son réel.`
    : "";
}

function selectedPart(): ScorePart | null {
  if (!score) return null;
  return score.parts[Number(partSelect.value)] ?? null;
}

function showMessage(kind: "warn" | "error", title: string, items: string[] = []): void {
  const box = document.createElement("div");
  box.className = `notice notice--${kind}`;
  const heading = document.createElement("strong");
  heading.textContent = title;
  box.append(heading);
  if (items.length) {
    const list = document.createElement("ul");
    for (const item of items) {
      const entry = document.createElement("li");
      entry.textContent = item;
      list.append(entry);
    }
    box.append(list);
  }
  messages.append(box);
}

function clearMessages(): void {
  messages.innerHTML = "";
}

async function handleFile(file: File): Promise<void> {
  clearMessages();
  sourceName = file.name.replace(/\.(mscz|mscx)$/i, "") || "partition";
  status.textContent = "";
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const mscx = file.name.toLowerCase().endsWith(".mscx")
      ? new TextDecoder().decode(buffer)
      : extractMscx(buffer);
    score = parseScore(mscx);
  } catch (error) {
    score = null;
    showMessage("error", error instanceof Error ? error.message : "Fichier illisible.");
    return;
  }
  fillParts(score);
  if (score.warnings.size) {
    showMessage(
      "warn",
      "Certains éléments ne sont pas repris à l'identique :",
      [...score.warnings].map((code) => UNSUPPORTED_LABELS[code]),
    );
  }
  await render();
}

function buildMusicXml(): string | null {
  const part = selectedPart();
  if (!score || !part) return null;
  const instrument = currentInstrument();
  const reading = currentReading();
  return toMusicXml({
    part,
    instrument,
    reading,
    valveCount: settings.valveCount,
    showFingerings: settings.showFingerings,
    showNoteNames: settings.showNoteNames,
    title: score.title || sourceName,
    partLabel: `${part.name} — ${reading.label}`.replace(/[♭♯]/g, (sign) => (sign === "♭" ? "b" : "#")),
    tempoBpm: score.tempoBpm,
  });
}

async function render(): Promise<void> {
  const musicXml = buildMusicXml();
  if (!musicXml) return;
  const token = ++renderToken;
  status.innerHTML = '<span class="spinner"></span> Gravure en cours…';
  actions.classList.remove("hidden");
  downloadButton.disabled = true;
  try {
    const svgPages = await engrave(musicXml, {
      showMeasureNumbers: settings.showMeasureNumbers,
    });
    if (token !== renderToken) return;
    renderedPages = svgPages;
    pages.innerHTML = "";
    for (const svg of svgPages) {
      const holder = document.createElement("div");
      holder.className = "preview__page";
      holder.innerHTML = svg;
      pages.append(holder);
    }
    preview.classList.remove("hidden");
    status.textContent = `${svgPages.length} page${svgPages.length > 1 ? "s" : ""}`;
    downloadButton.disabled = false;
  } catch (error) {
    if (token !== renderToken) return;
    status.textContent = "";
    showMessage("error", error instanceof Error ? error.message : "Gravure impossible.");
  }
}

async function download(): Promise<void> {
  if (!renderedPages.length) return;
  downloadButton.disabled = true;
  status.innerHTML = '<span class="spinner"></span> Préparation du PDF…';
  try {
    const { blob, mode } = await pagesToPdf(renderedPages);
    const reading = currentReading();
    downloadBlob(blob, `${sourceName} — ${reading.id}.pdf`);
    status.textContent = mode === "raster" ? "PDF prêt (rendu image)." : "PDF prêt.";
  } catch (error) {
    showMessage("error", error instanceof Error ? error.message : "Export PDF impossible.");
    status.textContent = "";
  } finally {
    downloadButton.disabled = false;
  }
}

function persist(): void {
  saveSettings(settings);
  instrumentHint.textContent = "Retenu pour la prochaine fois.";
}

function bind(): void {
  instrumentSelect.value = settings.instrumentId;
  fingeringToggle.checked = settings.showFingerings;
  noteNameToggle.checked = settings.showNoteNames;
  measureNumberToggle.checked = settings.showMeasureNumbers;
  fillReadings();

  instrumentSelect.addEventListener("change", () => {
    settings.instrumentId = instrumentSelect.value;
    settings.readingId = "";
    fillReadings();
    persist();
    if (score) partSelect.value = String(guessPart(score, currentInstrument()));
    updatePartHint();
    void render();
  });

  readingSelect.addEventListener("change", () => {
    settings.readingId = readingSelect.value;
    persist();
    void render();
  });

  valveSelect.addEventListener("change", () => {
    settings.valveCount = Number(valveSelect.value);
    persist();
    void render();
  });

  for (const [input, key] of [
    [fingeringToggle, "showFingerings"],
    [noteNameToggle, "showNoteNames"],
    [measureNumberToggle, "showMeasureNumbers"],
  ] as const) {
    input.addEventListener("change", () => {
      settings = { ...settings, [key]: input.checked };
      persist();
      void render();
    });
  }

  partSelect.addEventListener("change", () => {
    updatePartHint();
    void render();
  });

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.dataset.active = "true";
  });
  dropzone.addEventListener("dragleave", () => {
    delete dropzone.dataset.active;
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    delete dropzone.dataset.active;
    const file = event.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) void handleFile(file);
  });

  downloadButton.addEventListener("click", () => void download());
  resetButton.addEventListener("click", () => {
    score = null;
    renderedPages = [];
    fileInput.value = "";
    pages.innerHTML = "";
    preview.classList.add("hidden");
    actions.classList.add("hidden");
    partField.classList.add("hidden");
    clearMessages();
  });
}

if (settings.instrumentId === DEFAULT_SETTINGS.instrumentId) {
  instrumentHint.textContent = "Retenu pour la prochaine fois.";
}
bind();
