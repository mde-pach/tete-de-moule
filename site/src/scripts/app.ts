import { lireMscz, lireMscx, type PartitionMsc, type PartieMsc } from '../lib/mscz';
import { partieEnMusicXml } from '../lib/musicxml';
import { graver } from '../lib/gravure';
import { pdfDepuisSvg, telecharger, nomDeFichier } from '../lib/pdf';
import {
  INSTRUMENTS,
  instrumentParId,
  lectureParId,
  type Instrument,
} from '../lib/instruments';
import {
  lirePreferences,
  ecrirePreferences,
  lectureProbable,
  partieProbable,
  PREFERENCES_PAR_DEFAUT,
  type Preferences,
} from '../lib/preferences';

const NOMS_MIDI = ['Do', 'Ré\u266d', 'Ré', 'Mi\u266d', 'Mi', 'Fa', 'Sol\u266d', 'Sol', 'La\u266d', 'La', 'Si\u266d', 'Si'];

function nomDeHauteur(midi: number): string {
  return `${NOMS_MIDI[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function el<T extends HTMLElement>(id: string): T {
  const trouve = document.getElementById(id);
  if (!trouve) throw new Error(`Élément introuvable : ${id}`);
  return trouve as T;
}

export function demarrer(): void {
  // --- éléments -----------------------------------------------------------
  const pastille = el<HTMLButtonElement>('pastille-instrument');
  const pastilleValeur = el<HTMLSpanElement>('pastille-valeur');
  const panneau = el<HTMLDivElement>('panneau-instrument');
  const choixInstrument = el<HTMLSelectElement>('choix-instrument');
  const choixPistons = el<HTMLSelectElement>('choix-pistons');
  const choixLecture = el<HTMLSelectElement>('choix-lecture');
  const basculeDoigtes = el<HTMLInputElement>('bascule-doigtes');
  const basculeNoms = el<HTMLInputElement>('bascule-noms');

  const depot = el<HTMLLabelElement>('depot');
  const champFichier = el<HTMLInputElement>('fichier');
  const depotTitre = el<HTMLSpanElement>('depot-titre');
  const depotDetail = el<HTMLSpanElement>('depot-detail');
  const alerte = el<HTMLParagraphElement>('alerte');

  const etapeLigne = el<HTMLElement>('etape-ligne');
  const etapeReglages = el<HTMLElement>('etape-reglages');
  const etapeApercu = el<HTMLElement>('etape-apercu');
  const resumeFichier = el<HTMLParagraphElement>('resume-fichier');
  const listeLignes = el<HTMLDivElement>('lignes');
  const feuilles = el<HTMLDivElement>('feuilles');
  const etatGravure = el<HTMLParagraphElement>('etat-gravure');
  const boutonPdf = el<HTMLButtonElement>('bouton-pdf');

  // --- état ---------------------------------------------------------------
  let preferences: Preferences = lirePreferences() ?? { ...PREFERENCES_PAR_DEFAUT };
  const premiereVisite = lirePreferences() === null;
  let partition: PartitionMsc | null = null;
  let partieChoisie: PartieMsc | null = null;
  let choixManuel = false;
  let nomSource = '';
  let pages: string[] = [];
  let jeton = 0;

  const instrument = (): Instrument => instrumentParId(preferences.instrument) ?? INSTRUMENTS[0]!;

  function enregistrer(): void {
    ecrirePreferences(preferences);
  }

  function signaler(message: string | null): void {
    alerte.textContent = message ?? '';
    alerte.hidden = message === null;
  }

  // --- panneau instrument -------------------------------------------------
  function majPastille(): void {
    const i = instrument();
    const pistons = i.pistons.length > 1 ? ` · ${preferences.pistons} pistons` : '';
    pastilleValeur.textContent = `${i.court}${pistons}`;
  }

  function ouvrirPanneau(ouvert: boolean): void {
    panneau.hidden = !ouvert;
    pastille.setAttribute('aria-expanded', String(ouvert));
  }

  function remplirPistons(): void {
    const i = instrument();
    choixPistons.replaceChildren(
      ...i.pistons.map((n) => {
        const o = document.createElement('option');
        o.value = String(n);
        o.textContent = `${n} pistons`;
        return o;
      }),
    );
    if (!i.pistons.includes(preferences.pistons)) preferences.pistons = i.pistons[0]!;
    choixPistons.value = String(preferences.pistons);
    choixPistons.disabled = i.pistons.length < 2;
  }

  function remplirLectures(): void {
    const i = instrument();
    choixLecture.replaceChildren(
      ...i.lectures.map((l) => {
        const o = document.createElement('option');
        o.value = l.id;
        o.textContent = l.nom;
        return o;
      }),
    );
    if (!i.lectures.some((l) => l.id === preferences.lecture)) {
      preferences.lecture = i.lectures[0]!.id;
    }
    choixLecture.value = preferences.lecture;
  }

  // --- liste des portées --------------------------------------------------
  function dessinerLignes(): void {
    if (!partition) return;
    const jouables = partition.parties.filter((p) => p.nombreDeNotes > 0 && p.cle !== 'PERC');
    const suggeree = partieProbable(instrument(), partition.parties);

    listeLignes.replaceChildren(
      ...jouables.map((partie) => {
        const bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.className = 'ligne';
        bouton.setAttribute('role', 'radio');
        bouton.setAttribute('aria-checked', String(partie === partieChoisie));

        const nom = document.createElement('span');
        nom.className = 'ligne__nom';
        nom.textContent = partie.nom;
        if (partie === suggeree && !choixManuel) {
          const marque = document.createElement('span');
          marque.className = 'ligne__marque';
          marque.textContent = 'sans doute la tienne';
          nom.append(marque);
        }

        const detail = document.createElement('span');
        detail.className = 'ligne__detail';
        detail.textContent = `${partie.nombreDeNotes} notes`;

        const ambitus = document.createElement('span');
        ambitus.className = 'ligne__ambitus';
        ambitus.textContent = partie.ambitus
          ? `${nomDeHauteur(partie.ambitus[0])} – ${nomDeHauteur(partie.ambitus[1])}`
          : '';

        bouton.append(nom, ambitus, detail);
        bouton.addEventListener('click', () => {
          choixManuel = true;
          partieChoisie = partie;
          preferences.lecture = lectureProbable(instrument(), partie).id;
          enregistrer();
          remplirLectures();
          dessinerLignes();
          void rendre();
        });
        return bouton;
      }),
    );
  }

  // --- gravure ------------------------------------------------------------
  function attente(message: string): void {
    feuilles.replaceChildren();
    const f = document.createElement('div');
    f.className = 'feuille feuille--attente';
    f.textContent = message;
    feuilles.append(f);
  }

  async function rendre(): Promise<void> {
    if (!partition || !partieChoisie) return;
    const monJeton = ++jeton;
    boutonPdf.disabled = true;
    etatGravure.textContent = 'Gravure en cours…';
    if (!pages.length) attente('Préparation de la partition…');

    const i = instrument();
    const lecture = lectureParId(i, preferences.lecture) ?? i.lectures[0]!;
    try {
      const musicxml = partieEnMusicXml(partition, partieChoisie, {
        instrument: i,
        lecture,
        pistons: preferences.pistons,
        doigtes: preferences.doigtes,
        nomsDeNotes: preferences.nomsDeNotes,
        nomDePartie: partieChoisie.nom,
        tempo: partition.tempo,
      });
      const nouvelles = await graver(musicxml);
      if (monJeton !== jeton) return;
      pages = nouvelles;

      feuilles.replaceChildren(
        ...pages.map((svg) => {
          const f = document.createElement('div');
          f.className = 'feuille';
          f.innerHTML = svg;
          return f;
        }),
      );
      etatGravure.textContent = `${pages.length} page${pages.length > 1 ? 's' : ''} · A4`;
      boutonPdf.disabled = false;
      signaler(null);
    } catch (erreur) {
      if (monJeton !== jeton) return;
      pages = [];
      attente('Cette ligne n’a pas pu être gravée.');
      etatGravure.textContent = '';
      signaler(
        erreur instanceof Error
          ? erreur.message
          : "La gravure a échoué. Essaie une autre ligne de la partition.",
      );
    }
  }

  // --- chargement d'un fichier -------------------------------------------
  async function charger(fichier: File): Promise<void> {
    signaler(null);
    depotTitre.textContent = 'Lecture du fichier…';
    depotDetail.textContent = fichier.name;
    try {
      const donnees = new Uint8Array(await fichier.arrayBuffer());
      partition = fichier.name.endsWith('.mscx')
        ? lireMscx(new TextDecoder().decode(donnees))
        : lireMscz(donnees);
      if (!partition.parties.length) {
        throw new Error("Cette partition ne contient aucune portée.");
      }
      nomSource = fichier.name.replace(/\.(mscz|mscx)$/i, '');
      choixManuel = false;
      partieChoisie = partieProbable(instrument(), partition.parties);
      if (!partieChoisie) throw new Error("Aucune portée jouable dans cette partition.");
      preferences.lecture = lectureProbable(instrument(), partieChoisie).id;
      enregistrer();

      depot.classList.add('est-chargee');
      depotTitre.textContent = partition.titre || nomSource;
      depotDetail.textContent = 'Choisir un autre fichier';
      resumeFichier.textContent = `${partition.parties.length} portées · hauteurs réelles`;

      etapeLigne.hidden = false;
      etapeReglages.hidden = false;
      etapeApercu.hidden = false;
      remplirLectures();
      dessinerLignes();
      etapeLigne.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await rendre();
    } catch (erreur) {
      depot.classList.remove('est-chargee');
      depotTitre.textContent = 'Dépose ta partition ici';
      depotDetail.textContent = 'ou clique pour choisir un fichier .mscz';
      signaler(
        erreur instanceof Error
          ? erreur.message
          : "Ce fichier n'a pas pu être lu. Exporte-le depuis MuseScore au format .mscz.",
      );
    }
  }

  // --- écouteurs ----------------------------------------------------------
  pastille.addEventListener('click', () => ouvrirPanneau(panneau.hidden));

  choixInstrument.addEventListener('change', () => {
    preferences.instrument = choixInstrument.value;
    remplirPistons();
    remplirLectures();
    majPastille();
    if (partition) {
      if (!choixManuel) partieChoisie = partieProbable(instrument(), partition.parties);
      if (partieChoisie) preferences.lecture = lectureProbable(instrument(), partieChoisie).id;
      remplirLectures();
      dessinerLignes();
      void rendre();
    }
    enregistrer();
  });

  choixPistons.addEventListener('change', () => {
    preferences.pistons = Number(choixPistons.value);
    majPastille();
    enregistrer();
    void rendre();
  });

  choixLecture.addEventListener('change', () => {
    preferences.lecture = choixLecture.value;
    enregistrer();
    void rendre();
  });

  basculeDoigtes.addEventListener('change', () => {
    preferences.doigtes = basculeDoigtes.checked;
    enregistrer();
    void rendre();
  });

  basculeNoms.addEventListener('change', () => {
    preferences.nomsDeNotes = basculeNoms.checked;
    enregistrer();
    void rendre();
  });

  champFichier.addEventListener('change', () => {
    const fichier = champFichier.files?.[0];
    if (fichier) void charger(fichier);
  });

  for (const evenement of ['dragenter', 'dragover'] as const) {
    depot.addEventListener(evenement, (e) => {
      e.preventDefault();
      depot.classList.add('est-survolee');
    });
  }
  for (const evenement of ['dragleave', 'drop'] as const) {
    depot.addEventListener(evenement, () => depot.classList.remove('est-survolee'));
  }
  depot.addEventListener('drop', (e) => {
    e.preventDefault();
    const fichier = e.dataTransfer?.files?.[0];
    if (fichier) void charger(fichier);
  });
  // Sans cela, déposer à côté de la zone ouvre le fichier dans l'onglet.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  boutonPdf.addEventListener('click', async () => {
    if (!pages.length || !partieChoisie) return;
    const libelle = boutonPdf.textContent ?? 'Télécharger le PDF';
    boutonPdf.disabled = true;
    try {
      const blob = await pdfDepuisSvg(pages, {
        nom: nomSource,
        titre: partition?.titre || nomSource,
        progression: (faites, total) => {
          boutonPdf.textContent = `Page ${faites} sur ${total}…`;
        },
      });
      telecharger(blob, `${nomDeFichier(nomSource, partieChoisie.nom)}.pdf`);
    } catch (erreur) {
      signaler(
        erreur instanceof Error ? erreur.message : "Le PDF n'a pas pu être produit.",
      );
    } finally {
      boutonPdf.textContent = libelle;
      boutonPdf.disabled = false;
    }
  });

  // --- initialisation -----------------------------------------------------
  choixInstrument.value = preferences.instrument;
  remplirPistons();
  remplirLectures();
  basculeDoigtes.checked = preferences.doigtes;
  basculeNoms.checked = preferences.nomsDeNotes;
  majPastille();
  if (premiereVisite) {
    pastilleValeur.textContent = 'Choisir mon instrument';
    ouvrirPanneau(true);
  }
}
