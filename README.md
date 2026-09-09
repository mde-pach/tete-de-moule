# Tête de Moule

Le site de la fanfare des Moules Libres et Flamboyantes.

**https://mde-pach.github.io/tete-de-moule/**

Première brique : déposer une partition MuseScore, choisir son instrument, et
récupérer sa partie seule avec les doigtés et le nom des notes, en PDF.

Tout tourne dans le navigateur. Aucune partition n'est envoyée sur un serveur,
et il n'y a pas de compte à créer : l'instrument choisi est simplement retenu
dans le navigateur pour la fois suivante.

## Développement

```bash
cd site
npm install
npm run dev        # http://localhost:4321/tete-de-moule
npm run typecheck
npm run test
npm run build
```

Le site est reconstruit et publié sur GitHub Pages à chaque push sur `main`.

## Structure

```
site/src/lib/fingering.ts    doigtés, calculés depuis la série harmonique
site/src/lib/instruments.ts  catalogue : acoustique séparée de la lecture
site/src/lib/musescore.ts    lecture des .mscz
site/src/lib/musicxml.ts     réécriture d'une partie, avec les annotations
site/src/lib/engraving.ts    gravure via Verovio (WebAssembly)
site/src/lib/pdf.ts          export PDF
site/src/lib/settings.ts     réglages retenus d'une visite à l'autre
site/src/lib/messages.ts     tous les textes affichés, en français
```

L'interface est en français, le code est en anglais. Les chaînes destinées aux
musiciens sont regroupées dans `messages.ts` et dans les composants, ce qui rend
ce partage tenable.

## Comment les doigtés sont calculés

Aucune table n'est codée en dur. Le tube à vide produit une série d'harmoniques ;
chaque piston rallonge le tube et fait descendre la note (le 2 d'un demi-ton, le
1 d'un ton, le 3 d'un ton et demi, le 4 d'une quarte). Pour une note donnée, on
cherche l'harmonique le plus proche au-dessus, puis la combinaison qui comble
l'écart. Prendre l'harmonique le plus proche revient à prendre la combinaison la
plus courte, donc la plus juste.

Les doigtés se calculent toujours depuis la **hauteur réelle**, jamais depuis
l'écriture. Une partie peut donc être réécrite dans n'importe quelle clé sans
que les doigtés bougent.

## Le piège de l'octave

Trompette et euphonium partagent les mêmes doigtés, mais pas la même écriture :
la trompette lit une seconde majeure au-dessus du son réel, l'euphonium en clé
de sol une neuvième majeure. Appliquer la transposition de la trompette à une
partie d'euphonium met toutes les notes sous la portée. C'est pour ça que le
catalogue sépare l'acoustique de la lecture.

## Ce qui n'est pas encore repris

Le lecteur signale dans l'interface ce qu'il ne sait pas reproduire, plutôt que
de le laisser disparaître en silence : renvois (D.C., D.S., coda), notes
d'ornement, deuxième voix sur la portée, changements de clé en cours de morceau,
trilles, glissandos, arpèges. Les reprises, les voltas, les liaisons, les
triolets et les changements d'armure ou de mesure sont, eux, repris.

## Licence

À définir.
