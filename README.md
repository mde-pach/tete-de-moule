# tête-de-moule

Ajoute automatiquement les **doigtés** et les **noms de notes** sur une partition
MuseScore, pour les cuivres à pistons en Si♭ — euphonium, saxhorn basse, baryton,
trompette, bugle.

Tu donnes un `.mscz`, tu choisis ta partie, et tu récupères un PDF prêt à poser sur
le pupitre : une page de référence avec les notes du morceau, puis ta partie seule,
doigtée note par note.

## Pourquoi

Quand on débute un cuivre en fanfare, on passe les premières semaines à annoter sa
partition au crayon avant chaque répétition. C'est long, c'est fastidieux, et c'est
entièrement mécanique — donc automatisable.

## Installation

```bash
pip install -r requirements.txt
```

Aucune installation de MuseScore n'est nécessaire : la gravure passe par
[Verovio](https://www.verovio.org/).

## Utilisation

```bash
# 1. voir les parties du fichier
python3 doigtes_euphonium.py partition.mscz --lister

# 2. générer le PDF et le .mscz doigtés
python3 doigtes_euphonium.py partition.mscz --partie 4

# 3. en clé de sol (lecture Si♭, courante en fanfare française)
python3 doigtes_euphonium.py partition.mscz --partie 4 --cle sol
```

| Option | Effet |
| --- | --- |
| `--lister` | affiche les parties, leur clef, leur transposition, leur ambitus |
| `--partie N` | numéro de la partie à traiter |
| `--cle fa\|sol` | clef de lecture (`sol` ajoute le décalage d'octave, voir plus bas) |
| `--pistons 3\|4` | avec 4 pistons, `1-3` devient `4` et `1-2-3` devient `2-4` |
| `--sans-noms` | n'écrit que les doigtés, sans le nom des notes |
| `--nom` | nom affiché à gauche de la portée |
| `--tempo` | indication de tempo à afficher |
| `--sortie` | dossier de destination |

Sortie : un PDF (page de référence + la partie doigtée) et un `.mscz` ne contenant
que ta partie, avec les doigtés comme vrais éléments MuseScore, donc éditables.

## Fiches pédagogiques

```bash
cd outils
python3 tableau_complet.py        # les 7 combinaisons sur tout l'ambitus chromatique
python3 harmoniques.py            # pour chaque doigté, les notes qu'il permet d'obtenir
python3 comparaison_octave.py ../partition.mscz --partie 4 --de 31 --a 34
```

## Comment les doigtés sont calculés

Aucune table n'est codée en dur. Le tube à vide d'un instrument en Si♭ produit une
série d'harmoniques (Si♭1, Si♭2, Fa3, Si♭3, Ré4, Fa4, Si♭4…). Chaque piston rallonge
le tube et fait descendre la note : le 2 d'un demi-ton, le 1 d'un ton, le 3 d'un ton
et demi, le 4 d'une quarte juste.

Pour une note donnée, on cherche l'harmonique le plus proche **au-dessus** d'elle,
puis la combinaison de pistons qui comble l'écart :

```
0 → 2 → 1 → 1-2 → 2-3 → 1-3 → 1-2-3     (0 à 6 demi-tons sous l'harmonique)
```

Prendre l'harmonique le plus proche revient à prendre la combinaison la plus courte,
donc la plus juste. Les 7e et 11e harmoniques sont exclus : ils sonnent faux sur
l'instrument.

Conséquence utile : le résultat est correct dans tous les registres sans cas
particuliers. Un Ré grave se fait `1-3` et un Ré aigu `1`, parce qu'ils ne sont pas
accrochés au même harmonique.

## Le piège de l'octave

Trompette et euphonium partagent les mêmes doigtés, mais pas la même écriture :

- trompette en Si♭ → lit une **seconde majeure** au-dessus du son réel
- euphonium en clé de sol → lit une **neuvième majeure** au-dessus, soit une octave
  de plus

Appliquer la transposition de la trompette à une partie d'euphonium affichée en clé
de sol met toutes les notes sous la portée. C'est ce que gère `--cle sol`, et ce
qu'illustre `outils/comparaison_octave.py`.

## Savoir si une partie est déjà transposée

Dans le `.mscz`, MuseScore stocke pour chaque note la hauteur réelle (`pitch`) et
l'orthographe écrite (`tpc2`), et pour chaque partie un `transposeChromatic`. Si
celui-ci vaut `-2`, la partie est déjà écrite pour un instrument en Si♭ : il n'y a
rien à transposer. `--lister` affiche cette valeur pour chaque partie.

À la main, dans MuseScore : le bouton *Concert Pitch*. Si les notes bougent quand on
l'active, la partie est transposée.

## Formats

En entrée, `.mscz` (MuseScore 3 et 4). En sortie, PDF et `.mscz`.

Les partitions ne sont pas versionnées dans ce dépôt : la plupart des arrangements
de fanfare sont sous droits.

## Licence

MIT.
