/** Construit une URL absolue du site en tenant compte du chemin de base
 *  (le site est publié sous /tete-de-moule sur GitHub Pages). */
export function lien(chemin = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const suite = chemin.replace(/^\/+/, '');
  return suite ? `${base}/${suite}` : `${base}/`;
}
