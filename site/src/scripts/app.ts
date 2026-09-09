/**
 * Wiring for the fingering workbench.
 *
 * A player brings a folder, not one piece: several scores are held at once,
 * each keeping its own chosen part. The settings on the left are shared,
 * because they describe the player rather than the music — pick your
 * instrument once and every score follows.
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
const sheetList = element<HTMLElement>("sheets");
const actions = element<HTMLElement>("actions");
const preview = element<HTMLElement>("preview");
const pagesBox = element<HTMLElement>("pages");
const pageCounter = element<HTMLElement>("page-counter");
const previousPageButton = element<HTMLButtonElement>("page-prev");
const nextPageButton = element<HTMLButtonElement>("page-next");
const status = element<HTMLElement>("status");
const resetButton = element<HTMLButtonElement>("reset");
const fingeringToggle = element<HTMLInputElement>("show-fingerings");
const noteNameToggle = element<HTMLInputElement>("show-note-names");
const measureNumberToggle = element<HTMLInputElement>("show-measure-numbers");

type SheetState = "pending" | "ready" | "failed";

interface Sheet {
  /** File name without its extension; also the name of the PDF. */
  readonly name: string;
  readonly score: ParsedScore;
  /** Every score gets its own part: the player's line is not the same index. */
  partIndex: number;
  pages: string[];
  state: SheetState;
  problem: string;
}

let settings: Settings = loadSettings();
let sheets: Sheet[] = [];
let active = 0;
/**
 * Bumped whenever the settings change. Engraving walks the folder one score at
 * a time, so a pass left behind has to notice it is stale and stand down.
 */
let generation = 0;

function currentInstrument(): Instrument {
  return findInstrument(settings.instrumentId) ?? INSTRUMENTS[0]!;
}

function currentReading(): Reading {
  const instrument = currentInstrument();
  return findReading(instrument, settings.readingId) ?? instrument.readings[0]!;
}

function activeSheet(): Sheet | null {
  return sheets[active] ?? null;
}

function partOf(sheet: Sheet): ScorePart | null {
  return sheet.score.parts[sheet.partIndex] ?? null;
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------
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
    option.textContent = count === 0 ? "Coulisse" : `${count} pistons`;
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

function fillParts(): void {
  const sheet = activeSheet();
  partSelect.innerHTML = "";
  if (!sheet) {
    partField.classList.add("hidden");
    partHint.textContent = "";
    return;
  }
  sheet.score.parts.forEach((part, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${part.name}${part.noteCount ? "" : " (vide)"}`;
    option.disabled = part.noteCount === 0;
    partSelect.append(option);
  });
  partSelect.value = String(sheet.partIndex);
  partField.classList.remove("hidden");

  const part = partOf(sheet);
  partHint.textContent = part?.range
    ? `${part.noteCount} notes, de ${describeRange(part.range[0], part.range[1])} en son réel.`
    : "";
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
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

/** Warnings belong to a score, so they are redrawn when the selection moves. */
function renderMessages(): void {
  messages.innerHTML = "";
  const sheet = activeSheet();
  if (!sheet || sheet.score.warnings.size === 0) return;
  showMessage(
    "warn",
    `${sheet.name} : certains éléments ne sont pas repris à l'identique.`,
    [...sheet.score.warnings].map((code) => UNSUPPORTED_LABELS[code]),
  );
}

// ---------------------------------------------------------------------------
// The list of scores
// ---------------------------------------------------------------------------
function stateLabel(sheet: Sheet): string {
  if (sheet.state === "failed") return sheet.problem;
  if (sheet.state === "pending") return "Gravure…";
  return `${sheet.pages.length} page${sheet.pages.length > 1 ? "s" : ""}`;
}

function renderSheets(): void {
  sheetList.innerHTML = "";
  sheets.forEach((sheet, index) => {
    const row = document.createElement("div");
    row.className = "sheet" + (index === active ? " sheet--active" : "");

    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "sheet__pick";
    pick.setAttribute("aria-pressed", String(index === active));
    const title = document.createElement("span");
    title.className = "sheet__name";
    title.textContent = sheet.name;
    const detail = document.createElement("span");
    detail.className = "sheet__detail";
    detail.textContent = `${partOf(sheet)?.name ?? "—"} · ${stateLabel(sheet)}`;
    pick.append(title, detail);
    pick.addEventListener("click", () => select(index));

    const download = document.createElement("button");
    download.type = "button";
    download.className = "button button--accent sheet__action";
    download.textContent = "PDF";
    download.disabled = sheet.state !== "ready";
    download.addEventListener("click", () => void downloadSheet(sheet));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button--quiet sheet__action";
    remove.textContent = "✕";
    remove.setAttribute("aria-label", `Retirer ${sheet.name}`);
    remove.addEventListener("click", () => removeSheet(index));

    row.append(pick, download, remove);
    sheetList.append(row);
  });
  sheetList.classList.toggle("hidden", sheets.length === 0);
  actions.classList.toggle("hidden", sheets.length === 0);
}

function select(index: number): void {
  if (index === active || !sheets[index]) return;
  active = index;
  fillParts();
  renderMessages();
  renderSheets();
  showPages();
}

function removeSheet(index: number): void {
  sheets.splice(index, 1);
  if (active >= sheets.length) active = Math.max(0, sheets.length - 1);
  fillParts();
  renderMessages();
  renderSheets();
  showPages();
}

// ---------------------------------------------------------------------------
// Viewer: one page at a time, arrows on a desktop, a swipe on a phone
// ---------------------------------------------------------------------------
function showPages(): void {
  const sheet = activeSheet();
  pagesBox.innerHTML = "";
  if (!sheet || sheet.state !== "ready" || sheet.pages.length === 0) {
    preview.classList.add("hidden");
    updateCounter();
    return;
  }
  for (const svg of sheet.pages) {
    const holder = document.createElement("div");
    holder.className = "preview__page";
    holder.innerHTML = svg;
    pagesBox.append(holder);
  }
  preview.classList.remove("hidden");
  pagesBox.scrollTo({ left: 0 });
  updateCounter();
}

/**
 * Where each page starts, measured from the pages themselves rather than from
 * the container width: the gap between them makes those two drift a little
 * further apart with every page.
 */
function pageOffsets(): number[] {
  const children = [...pagesBox.children] as HTMLElement[];
  if (children.length === 0) return [];
  const origin = children[0]!.offsetLeft;
  return children.map((child) => child.offsetLeft - origin);
}

function pageIndex(): number {
  const offsets = pageOffsets();
  if (offsets.length === 0) return 0;
  let best = 0;
  let bestDistance = Infinity;
  offsets.forEach((offset, index) => {
    const distance = Math.abs(offset - pagesBox.scrollLeft);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function updateCounter(): void {
  const total = activeSheet()?.pages.length ?? 0;
  const current = total ? pageIndex() + 1 : 0;
  pageCounter.textContent = total ? `Page ${current} / ${total}` : "";
  previousPageButton.disabled = current <= 1;
  nextPageButton.disabled = current === 0 || current >= total;
}

function turnPage(delta: number): void {
  const offsets = pageOffsets();
  const target = Math.min(Math.max(pageIndex() + delta, 0), offsets.length - 1);
  const left = offsets[target];
  if (left === undefined) return;
  pagesBox.scrollTo({ left, behavior: "smooth" });
}

// ---------------------------------------------------------------------------
// Engraving
// ---------------------------------------------------------------------------
function buildMusicXml(sheet: Sheet): string | null {
  const part = partOf(sheet);
  if (!part) return null;
  const reading = currentReading();
  return toMusicXml({
    part,
    instrument: currentInstrument(),
    reading,
    valveCount: settings.valveCount,
    showFingerings: settings.showFingerings,
    showNoteNames: settings.showNoteNames,
    title: sheet.score.title || sheet.name,
    partLabel: `${part.name} — ${reading.label}`.replace(/[♭♯]/g, (sign) => (sign === "♭" ? "b" : "#")),
    tempoBpm: sheet.score.tempoBpm,
  });
}

async function engraveSheet(sheet: Sheet, token: number): Promise<void> {
  const musicXml = buildMusicXml(sheet);
  if (!musicXml) {
    sheet.state = "failed";
    sheet.problem = "partie vide";
    return;
  }
  try {
    const svgPages = await engrave(musicXml, {
      showMeasureNumbers: settings.showMeasureNumbers,
    });
    if (token !== generation) return;
    sheet.pages = svgPages;
    sheet.state = "ready";
    sheet.problem = "";
  } catch (error) {
    if (token !== generation) return;
    sheet.pages = [];
    sheet.state = "failed";
    sheet.problem = error instanceof Error ? error.message : "gravure impossible";
  }
}

/**
 * Re-engraves everything, active score first, so the viewer fills straight
 * away while the rest of the folder catches up behind it.
 */
async function refresh(): Promise<void> {
  if (sheets.length === 0) {
    status.textContent = "";
    renderSheets();
    showPages();
    return;
  }
  const token = ++generation;
  for (const sheet of sheets) {
    sheet.state = "pending";
    sheet.pages = [];
  }
  renderSheets();
  showPages();

  const order = [active, ...sheets.map((_, index) => index)];
  const seen = new Set<number>();
  let done = 0;
  for (const index of order) {
    if (seen.has(index)) continue;
    seen.add(index);
    if (token !== generation) return;
    const sheet = sheets[index];
    if (!sheet) continue;

    done += 1;
    status.innerHTML =
      `<span class="spinner"></span> Gravure ${done} / ${sheets.length}…`;
    await engraveSheet(sheet, token);
    if (token !== generation) return;
    renderSheets();
    if (index === active) showPages();
  }
  status.textContent = "";
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
async function readSheet(file: File): Promise<Sheet | string> {
  const name = file.name.replace(/\.(mscz|mscx)$/i, "") || "partition";
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const mscx = file.name.toLowerCase().endsWith(".mscx")
      ? new TextDecoder().decode(buffer)
      : extractMscx(buffer);
    const parsed = parseScore(mscx);
    return {
      name,
      score: parsed,
      partIndex: guessPart(parsed, currentInstrument()),
      pages: [],
      state: "pending",
      problem: "",
    };
  } catch (error) {
    return `${name} : ${error instanceof Error ? error.message : "fichier illisible"}`;
  }
}

async function handleFiles(files: FileList | File[]): Promise<void> {
  const incoming = [...files];
  if (incoming.length === 0) return;
  const failures: string[] = [];
  const added: Sheet[] = [];
  for (const file of incoming) {
    const result = await readSheet(file);
    if (typeof result === "string") failures.push(result);
    else added.push(result);
  }
  if (added.length) {
    const firstNew = sheets.length;
    sheets = [...sheets, ...added];
    active = firstNew;
  }
  fillParts();
  renderMessages();
  if (failures.length) {
    showMessage(
      "error",
      failures.length > 1 ? "Fichiers illisibles :" : "Fichier illisible :",
      failures,
    );
  }
  await refresh();
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
async function downloadSheet(sheet: Sheet): Promise<void> {
  if (sheet.state !== "ready" || sheet.pages.length === 0) return;
  status.innerHTML = `<span class="spinner"></span> PDF de ${sheet.name}…`;
  try {
    const { blob, mode } = await pagesToPdf(sheet.pages);
    downloadBlob(blob, `${sheet.name} — ${currentReading().id}.pdf`);
    status.textContent = mode === "raster" ? "PDF prêt (rendu image)." : "PDF prêt.";
  } catch (error) {
    showMessage("error", error instanceof Error ? error.message : "Export PDF impossible.");
    status.textContent = "";
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
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
    // Another instrument means another line, in every score.
    for (const sheet of sheets) {
      sheet.partIndex = guessPart(sheet.score, currentInstrument());
    }
    fillParts();
    void refresh();
  });

  readingSelect.addEventListener("change", () => {
    settings.readingId = readingSelect.value;
    persist();
    void refresh();
  });

  valveSelect.addEventListener("change", () => {
    settings.valveCount = Number(valveSelect.value);
    persist();
    void refresh();
  });

  for (const [input, key] of [
    [fingeringToggle, "showFingerings"],
    [noteNameToggle, "showNoteNames"],
    [measureNumberToggle, "showMeasureNumbers"],
  ] as const) {
    input.addEventListener("change", () => {
      settings = { ...settings, [key]: input.checked };
      persist();
      void refresh();
    });
  }

  partSelect.addEventListener("change", () => {
    const sheet = activeSheet();
    if (!sheet) return;
    sheet.partIndex = Number(partSelect.value);
    fillParts();
    void refresh();
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
    const dropped = event.dataTransfer?.files;
    if (dropped?.length) void handleFiles(dropped);
  });
  fileInput.addEventListener("change", () => {
    const chosen = fileInput.files;
    if (chosen?.length) void handleFiles(chosen);
    // Cleared so the same file can be picked again after being removed.
    fileInput.value = "";
  });

  previousPageButton.addEventListener("click", () => turnPage(-1));
  nextPageButton.addEventListener("click", () => turnPage(1));
  pagesBox.addEventListener("scroll", updateCounter, { passive: true });
  window.addEventListener("resize", updateCounter);

  resetButton.addEventListener("click", () => {
    generation += 1;
    sheets = [];
    active = 0;
    fileInput.value = "";
    fillParts();
    renderMessages();
    renderSheets();
    showPages();
    status.textContent = "";
  });
}

if (settings.instrumentId === DEFAULT_SETTINGS.instrumentId) {
  instrumentHint.textContent = "Retenu pour la prochaine fois.";
}
bind();
renderSheets();
