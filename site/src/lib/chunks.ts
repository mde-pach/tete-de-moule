/**
 * Loads a lazily-imported chunk, surviving a deployment that happened while
 * the page was open.
 *
 * Every build renames its chunks after their contents, and publishing replaces
 * the whole directory. A tab opened before a deploy therefore holds an HTML
 * page and an entry script that point at files the server no longer has. The
 * page keeps working until it reaches for a chunk it has not loaded yet —
 * typically the PDF writer, which only arrives when someone clicks download.
 * GitHub Pages answers the missing file with its 404 page, and the browser
 * refuses to run HTML as a module:
 *
 *     Loading module from "…/_astro/jspdf.es.min.<hash>.js" was blocked
 *     because of a disallowed MIME type ("text/html")
 *
 * Reloading fetches the current page and its current chunk names. A flag makes
 * sure that happens at most once, so a genuine failure surfaces as an error
 * instead of trapping the user in a reload loop.
 */
const RELOAD_FLAG = "tete-de-moule:chunk-reload";

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) !== null;
  } catch {
    return true; // No session storage: never reload, we could not stop a loop.
  }
}

function writeFlag(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(RELOAD_FLAG, "1");
    else sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // Private browsing can refuse storage; the reload guard is best-effort.
  }
}

export async function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    const module = await load();
    // Got through: a later deploy deserves its own reload.
    writeFlag(false);
    return module;
  } catch (error) {
    if (!readFlag()) {
      writeFlag(true);
      location.reload();
      // The page is going away; never settle, so no caller shows an error.
      return new Promise<T>(() => {});
    }
    throw new Error(
      "Une partie de l'application n'a pas pu être chargée. " +
        "Recharge la page pour récupérer la dernière version.",
      { cause: error },
    );
  }
}
