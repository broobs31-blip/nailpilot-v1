# NailPilot V2 — Vérification finale indépendante (Lot 1)

**Date** : 24 octobre 2026 · **Branche** : `claude/happy-heisenberg-iqbqm0` (non commitée) · **Méthode** : rien n'est tenu pour acquis à partir des rapports précédents. Chaque ligne ci-dessous repose sur une commande exécutée ou sur un parcours Playwright piloté à 390 px et 1440 px, avec horloge figée sur le samedi 24/10/2026 à 10 h (Paris), la veille du passage à l'heure d'hiver.

## 1. Verdict

### **PRÊT DÉMO** — pas encore PRÊT BÊTA

**Pourquoi PRÊT DÉMO** : en mode démonstration local, tous les parcours du Lot 1 fonctionnent de bout en bout aux deux largeurs : aucune erreur console (CSP de production appliquée pendant les tests), aucun débordement horizontal, aucun texte anglais ni format AM/PM dans l'interface, et 7 095 créneaux publics vérifiés un par un sans aucune anomalie. 8 bugs avérés ont été corrigés, avec des tests de non-régression.

**Pourquoi pas PRÊT BÊTA** : une bêta « avec de vraies clientes » exige ce qui n'a **jamais été exécuté** :

- un projet Supabase réel : authentification, e-mails, RLS sur une instance hébergée, calcul des créneaux côté serveur ;
- le captcha Turnstile, marqué bloquant par l'audit sécurité ;
- l'effacement effectif d'un compte sous 30 jours : aucun job n'existe ;
- un test sur Safari iOS réel.

S'y ajoutent une CI qui ne tournera pas sur cette branche et l'absence de choix « fusionner ou créer » pour les fiches clientes en doublon (F7).

## 2. Commandes exécutées (preuves)

| Commande | Avant corrections | Après corrections |
|---|---|---|
| `npm ci --ignore-scripts` | OK, 0 vulnérabilité | — |
| `npm test` | 95/95 | **100/100** (+5 dans `tests/ui.test.js`), aussi avec `TZ=UTC` et `TZ=America/Los_Angeles` |
| `npm run build` | OK (pro 120 kB, public 17,8 kB, chunk partagé 279 kB / 76 kB gzip) | OK |
| `npm run test:e2e` (Chromium local, bureau 1440 + iPhone 13) | 12/12 | **20/20** (+4 tests × 2 projets) |

Scripts d'exploration et captures, hors dépôt : `/tmp/claude-0/-home-user-nailpilot-v1/de677ac3-7ba3-5250-8c86-36df5d02c4c6/scratchpad/`. Les scripts sont `crawl.cjs` et `j1.cjs` à `j11.cjs` ; les captures sont dans `shots/` (avant) et `shots/apres/` (après).

- **Balayage de 27 routes × 2 largeurs** (`crawl.cjs`), avec l'en-tête CSP de `vercel.json` injecté. Résultat : 0 erreur console, 0 débordement, 0 texte anglais/« undefined »/« NaN », 0 AM/PM, 0 contrôle sans nom accessible.
- **Performance indicative** (`perf.cjs`, réseau 1,6 Mb/s, RTT 150 ms, CPU ×4) : page publique interactive en 1,2 s à froid et 0,6 s à chaud. Lighthouse n'a pas été lancé.

## 3. Critères d'acceptation du Lot 1

PASS = vérifié par exécution · FAIL→CORRIGÉ = bug avéré corrigé dans cette passe · PARTIEL = en partie conforme · NON TESTABLE = impossible sans Supabase ou appareil réel.

| # | Critère | Statut | Preuve |
|---|---|---|---|
| F1.1 | Inscription + e-mail de confirmation exigé | NON TESTABLE | Pas de projet Supabase |
| F1.2 | Connexion, déconnexion, mot de passe oublié, session persistée | PASS (démo) / NON TESTABLE (réel) | `j7` : refus d'un mot de passe de 7 caractères, connexion, rechargement → session conservée, garde → `/connexion` |
| F1.3 | Erreur générique « Identifiants incorrects » | NON TESTABLE | La démo accepte tout |
| F1.4 | RLS A/B et anonyme | NON TESTABLE (hébergé) | Couvert seulement par `tests/database.test.js` (PGlite), qui passe |
| F1.5 | Redirection vers l'assistant tant que le profil est incomplet | PASS | Garde `needsOnboarding` + e2e onboarding |
| F1.6 | Mode démo disponible et signalé | PASS | Bandeau « Mode démonstration » sur toutes les captures |
| F2.1 | Assistant en 3 étapes (métiers, nom + ville, mode) | PASS | e2e onboarding |
| F2.2 | Adresse de base jamais publique (ville seulement) | PASS | Page publique : « L'adresse exacte vous est communiquée à la confirmation » |
| F2.3 | Zone (CP / rayon) + trajet par défaut | PASS | e2e onboarding |
| F2.4 | Slug 3-40 caractères, proposé, slugs réservés refusés | PASS | e2e (« atelier-ines ») + tests du domaine |
| F2.5 | Champs publics et privés dans des tables distinctes | PASS (code) | `np_public_profiles` / `np_profiles` |
| F3.1 | 1 à 3 plages, sans chevauchement, fin > début | PASS | `j4` : « Les plages… ne doivent pas se chevaucher », « La fin d'une plage doit être après son début », 4e plage impossible |
| F3.2 | Fermetures exceptionnelles prioritaires | PASS | `j1` : aucun créneau le 7/11 (« Formation ») ; date de fin < date de début refusée |
| F3.3 | Changer les horaires ne touche aucun RDV ; badge « hors horaires » | **FAIL→CORRIGÉ** | Les RDV étaient conservés, mais aucun badge n'existait. Badge ajouté (liste et frise), voir `shots/apres/fix-jour-25-*.png` |
| F3.4 | RDV manuel hors horaires après confirmation explicite | PASS | `j4` : « Cochez « Je confirme ce créneau malgré tout » », puis création |
| F4.1 | Catalogue pré-rempli par métier, modifiable | PASS | Durées et prix conformes à la spec (Pose complète 2 h/55 €, etc.) |
| F4.2 | Bornes (durée 15-480 min par pas de 5, prix 0-2 000 €…) | PASS, messages **FAIL→CORRIGÉ** | 7 min, 62 min et 2 500 € refusés, mais avec les messages anglais du navigateur (« Value must be greater than or equal to 15. »). Messages désormais en français |
| F4.3 | Réordonnancement reflété sur la page publique | PASS | `j4` : « Remplissage » monté → 1er sur `/r/studio-demo` |
| F4.4 | Archivage : retirée de la réservation, nom figé sur les RDV | PASS | `j4` |
| F4.5 | Liste fermée V1 remplacée | PASS (code) | `SERVICES` ne sert plus qu'à la signature V1 dépréciée |
| F5.1 | Jour par défaut sur mobile, semaine ≥ 768 px, bascule mémorisée | PASS | `j11` : 390 → jour ; semaine choisie conservée après rechargement ; 1440 → semaine |
| F5.2 | Semaine lisible à 390 px sans défilement horizontal | PASS | Liste par jour, `scrollWidth = 390` |
| F5.3 | Heure, cliente, prestation, lieu, ville, statut, tampon hachuré | **FAIL→CORRIGÉ** | Dans un bloc de 45 min, le nom de la cliente était écrasé à 1,4 px de haut (`shots/1440-_agenda_jour_2026_10_25.png`). Corrigé, avec test e2e |
| F5.4 | Statuts distincts (libellé + couleur) | PASS (contraste AA non mesuré) | Badges `pending` / `booked` / `done` / `cancelled` / `no_show` |
| F5.5 | Création en touchant un créneau libre ; déplacement par formulaire | PASS | `j4` : clic sur 17 h 30 → formulaire prérempli ; déplacement dimanche → mardi OK |
| F5.6 | Chevauchement refusé, tampons inclus (interface et base) | PASS (interface) / PGlite (base) | `j4` : déplacement sur une demande en attente refusé ; e2e 16 h refusé, 16 h 15 accepté |
| F5.7 | Plages fermées grisées ; heures justes aux changements d'heure | PASS | `j2` (voir §4) |
| F6.1 | Lieu `pro` ou `client` avec adresse | PASS | `j3` |
| F6.2 | Lieux autorisés ; CP hors zone refusé ; forçage pro | PASS | « Mariée jour J » proposée à domicile seulement ; 75001 → « Désolée, Studio Démo ne se déplace pas encore au 75001… » ; avertissement `outside_zone` à confirmer côté pro |
| F6.3 | `starts/ends` + `block_start/end` | PASS | Code et tests du domaine |
| F6.4 | Tampon R1 modifiable de 0 à 120 min par RDV | PASS | e2e |
| F6.5 | « Ouvrir dans Maps » | PASS | `https://www.google.com/maps/search/?api=1&query=8%20avenue%20de%20Lyon…` |
| F7.1 | Reprise V1 (recherche, E.164, consentements non précochés, historique, archivage) | PASS | `j4` : `tel:+33612345678`, cases `[false,false]` |
| F7.2 | Adresses multiples, infos d'accès, prénom d'usage, source | PASS | Fiche Sofia : adresse principale + digicode |
| F7.3 | Réservation en ligne crée ou rattache ; en cas de doute, la pro choisit fusionner ou créer | **PARTIEL** | Rattachement si téléphone ET nom identiques ; sinon nouvelle fiche **sans proposer de fusion** |
| F7.4 | Avertissement R7 sous les notes | PASS | Texte exact affiché |
| F7.5 | Export JSON/CSV + suppression définitive (anonymisation) | PASS, CSV **FAIL→CORRIGÉ** | Le CSV ne contenait que les RDV : fichier **vide** pour une cliente sans historique, et aucune identité. Corrigé. Suppression : fiche et consentements effacés, RDV passé `client_id=null` + `anonymized_at` |
| F8.1 | URL publique sans compte + « Copier mon lien » + aperçu | PASS (écart assumé) | URL `/r/<slug>` au lieu de `/<slug>` (décision ARCHITECTURE §3) |
| F8.2 | 4 écrans max, champs, consentements non précochés, lien confidentialité | PASS | `j3` : `[false,false]`, message `maxlength=300`, lien `/#/confidentialite` |
| F8.3 | Créneaux conformes (horaires, fermetures, RDV + tampons, délais R3, grille R4) | PASS | `j1` : 13 couples prestation/lieu × 2 heures de test (sam. 10 h et sam. 23 h 30), **7 095 créneaux vérifiés, 0 anomalie**, et liste identique au calcul attendu (aucun dans le passé, hors horaires, hors grille, hors délai ni en conflit) |
| F8.4 | Créneaux calculés côté serveur | NON TESTABLE | En démo, calcul local ; la fonction SQL n'est testée que sous PGlite |
| F8.5 | Création atomique : « Ce créneau vient d'être réservé » | PASS | `j3`, deux onglets sur le même créneau : le 2e voit le message, le créneau disparaît de la liste (`shots/j3-stale-390.png`) |
| F8.6 | Captcha + 5/h par téléphone et IP + pot de miel | **PARTIEL** | Pot de miel OK ; plafond de 3 demandes en attente par téléphone OK ; **pas de captcha** ; limite par IP seulement en SQL |
| F8.7 | Confirmation : récapitulatif, statut, `.ics` | PASS | `.ics` : `DTSTART:20261027T080000Z`, `SUMMARY:Coupe femme · Studio Démo` |
| F8.8 | < 2,5 s en 4G ; Lighthouse ≥ 90 ; Open Graph | PARTIEL | 1,2 s mesuré ; Lighthouse non lancé ; balises OG **génériques** (application à page unique, pas d'aperçu propre à la pro sur Instagram) |
| F8.9 | Ville, prestations, prix ou « sur devis », jamais l'adresse | PASS | — |
| F9.1 | Validation manuelle par défaut, auto possible | PASS | — |
| F9.2 | Demande `pending` bloquante 24 h max ; compteur de navigation | PASS | Compteur 1 → 5 après les réservations |
| F9.3 | Accepter / refuser avec motif + message prêt | **FAIL→CORRIGÉ** | Après un refus, l'onglet Rappels proposait « …votre rendez-vous … **est confirmé** » (étiquette « Confirmation »). Il propose désormais le modèle de refus (étiquette « Refus ») |
| F9.4 | Expiration à 24 h, créneau libéré, pro informée | PASS | `j3` (+25 h) : « 3 demandes ont expiré sans réponse : le créneau a été libéré. » |
| F10.1 | Rappel 24 h avant (RDV `booked` + consentement), invalidé à l'annulation | PASS | `j11` : rappel de Sofia présent, disparaît après annulation |
| F10.2 | Message selon le lieu ; modèles avec variables | PASS | « …chez vous au 5 rue Alsace, 31000 Toulouse. » |
| F10.3 | Copier / SMS / WhatsApp ; « traité » ≠ envoyé | PASS | `wa.me/33622334455?text=…`, `sms:+33622334455?&body=…`, presse-papiers vérifié |
| F10.4 | Même moteur de modèles | PASS (code) | `buildMessage` |
| F11.1 | Délai de la prestation, sinon de la fiche ; désactivable | PASS (code + tests du domaine) | — |
| F11.2 | Lien de réservation dans la relance | PASS | Modèle `refill` avec `{lien}` |
| F12.1 | Confidentialité et mentions liées depuis la page publique et l'app | PASS | Pied de page public + Réglages > Compte |
| F12.2 | Export complet (JSON) + suppression avec confirmation, effacement sous 30 j | PARTIEL | Export OK (11 clés) ; page dépubliée aussitôt (`/r/studio-demo` → « n'existe pas ») ; **aucun job d'effacement à 30 jours** dans `supabase/` |
| F12.3 | Journal des consentements | PASS | Fiche cliente > « Journal des consentements » |

**Bilan sur 59 critères** : 46 PASS (dont F1.2 en démo seulement, et quelques-uns vérifiés par le code ou PGlite, indiqués « (code) »), 5 FAIL→CORRIGÉ (F3.3, F4.2, F5.3, F7.5, F9.3), 4 PARTIEL (F7.3, F8.6, F8.8, F12.2) et 4 NON TESTABLE (F1.1, F1.3, F1.4, F8.4). Le §6 liste aussi 3 bugs corrigés hors critères (lien d'évitement, changement d'heure, « 1er »).

## 4. Changement d'heure (vérifié dans le navigateur)

Ouverture le dimanche de 0 h à 6 h, aucun délai minimum, prestation de 45 min (`j2`) :

- **25/10/2026 (heure d'hiver)** : créneaux 0 h, 0 h 30, 1 h, 1 h 30, 3 h, 3 h 30, 4 h, 4 h 30, 5 h. Les heures 2 h et 2 h 30, ambiguës car elles existent deux fois, ne sont pas proposées : choix prudent, accepté.
- **28/03/2027 (heure d'été)** : 2 h et 2 h 30, qui n'existent pas, ne sont pas proposées (R2). La réservation à 3 h donne bien « 3 h – 3 h 45 », et l'agenda la place à 3 h.
- **Saisie pro à 02:30** ces deux jours : refus avec « Cette heure est inexistante ou ambiguë lors du changement d'heure. Choisissez une autre heure. »
- **Bug corrigé** (`timeline.js`) : la fin de journée était calculée en « début + 24 h ». Une fermeture du lundi 29/03/2027 grisait donc tout le dimanche 28/03, qui ne dure que 23 h. Test ajouté dans `tests/ui.test.js`.

## 5. CI GitHub (`.github/workflows/verify.yml`) et `playwright.config.js`

- **Déclencheurs** : `push` seulement sur `codex/**`, et `pull_request` vers `main`. **Un push sur `claude/happy-heisenberg-iqbqm0` ne lance rien.** Seule une PR vers `main` déclenchera la vérification. À corriger : ajouter `'claude/**'` aux branches de `push`, ou toujours passer par une PR.
- **Chromium local dans `playwright.config.js`** : en CI, ni `PLAYWRIGHT_BROWSERS_PATH` ni `CHROMIUM_PATH` ne sont définis. `localChromium()` renvoie donc `undefined` et `launchOptions` vaut `{}` (vérifié en évaluant la config avec `CI=1`). Playwright utilise alors le Chromium installé par `npx playwright install --with-deps chromium`. **Ça ne casse pas la CI.** `reuseExistingServer` vaut `false` en CI, ce qui est correct.
- **Défaut local mineur** : `readdirSync(...).sort()` trie les dossiers par ordre lexicographique (`chromium-999` passe après `chromium-1243`). Sans effet en CI.
- **Hypothèse non vérifiée** : la CI ne peut pas être exécutée d'ici. Les mêmes commandes passent en local avec Node 22, alors que la CI utilise Node 24.

## 6. Bugs corrigés dans cette passe (avec non-régression)

| # | Bug (preuve) | Correctif | Test |
|---|---|---|---|
| 1 | « Aller au contenu » mène à `#main`, que le routeur à hash traite comme « **Page introuvable** » (`j6`) | `src/views/pro.js` : `preventDefault` + focus sur `<main>` | e2e « accessibilité : Aller au contenu… » |
| 2 | Demande refusée → l'onglet Rappels propose « …**est confirmé** » (`j3`). La base range la réponse acceptée comme refusée sous `kind='confirmation'` | `src/views/messages.js` : RDV `cancelled` → modèle `decline`, étiquette « Refus » | e2e « refus d'une demande… » |
| 3 | F3 : aucun badge « hors horaires » sur un RDV hors horaires ou pendant une fermeture | `appointment-card.js` (`isOutsideHours`, `outsideHoursBadge`), `timeline.js`, `style.css` | `ui.test.js` + e2e F3 (jour, semaine, 2 largeurs) |
| 4 | Frise : nom de la cliente invisible dans un RDV de 45 min (hauteur 1,4 px) | `style.css` : `.tl-client`/`.tl-time { flex-shrink: 0 }` | e2e F3 (hauteur > 10 px ; échoue sans le correctif, vérifié) |
| 5 | Messages de validation dans la langue du navigateur (« Value must be… », « Please enter a valid value… ») | `dialog.js` : `validationText()` en français, réutilisé par `onboarding.js` | e2e « formulaires : messages de validation en français » |
| 6 | Export CSV d'une fiche vide si la cliente n'a pas de RDV ; aucune identité ; dates UTC brutes | `clients.js` : `clientCsv()` (identité + historique, heure de Paris, statut en français) | `ui.test.js` |
| 7 | Fin de journée = début + 24 h (fermeture du lendemain grise le dimanche de 23 h) | `timeline.js` : minuit local suivant | `ui.test.js` (échoue sur l'ancien code) |
| 8 | Typographie : « Semaine du 26 oct. au **1 novembre** », « le dimanche 1 novembre » dans les messages | `format.js` (`dayLabel`, `dateTimeLabel`), `domain.js` (`buildMessage`) → « 1er » | `ui.test.js` |

Fichiers touchés : `package.json` (ajout de `tests/ui.test.js` au script `test`), `src/components/{appointment-card,dialog,format,timeline}.js`, `src/domain.js`, `src/style.css`, `src/views/{clients,messages,onboarding,pro}.js`, `tests/e2e/app.spec.js`, `tests/ui.test.js` (nouveau).

## 7. Bugs et manques restants (classés)

### Bloquants avant une bêta avec de vraies clientes
1. **Aucun projet Supabase hébergé** : F1 (inscription, e-mail, erreurs génériques), RLS réelle, `np_available_slots` / `np_request_booking` côté serveur et contrainte GiST n'ont jamais tourné hors PGlite.
2. **Captcha Turnstile absent** (F8.6). L'audit sécurité le classe bloquant pour toute ouverture publique : robots de demandes, plafonds contournables.
3. **Effacement sous 30 jours non implémenté** (F12.2) : `deletion_requested_at` est posé, mais aucune tâche ne purge les données. C'est un engagement RGPD affiché à l'écran.
4. **Expiration des demandes côté serveur** : elle dépend de `pg_cron` (`supabase/enable-preview-scheduler.sql`, optionnel) ou d'un appel à l'ouverture. Sans tâche planifiée, elle est à vérifier sur le projet réel.
5. **Test manuel Safari iOS non fait.** De plus, en émulation iPhone 13 (Chromium), Playwright ne juge jamais « stable » les boutons de l'écran Réglages > Horaires (« Enregistrer les horaires », « Ajouter »). Le clic forcé fonctionne et le Pixel 7 n'a pas le problème : c'est probablement un artefact d'émulation, mais à confirmer sur un vrai iPhone.
6. **CI** : ne se déclenche pas sur les branches `claude/**` (§5).

### Majeurs
7. **F7.3** : pas de choix « fusionner ou créer ». Un même numéro avec un autre nom crée une deuxième fiche sans le signaler à la pro.
8. **F8.8** : Open Graph générique (« Réserver en ligne · NailPilot ») pour toutes les pros. L'aperçu Instagram n'affiche ni le nom ni la ville, faute de rendu serveur ou de prérendu par slug.
9. **Racine du bug n° 2** : en base, `np_appointment_events` crée `kind='confirmation'` aussi pour un refus. L'interface est corrigée ; il faudrait un `kind` distinct (`decline`) côté SQL et démo.
10. **Limite par IP** : appliquée seulement en SQL, avec un en-tête IP à valider sur la vraie passerelle (audit §1, n° 3).

### Mineurs
11. Libellé de tampon (« Préparation 10 min après ») qui déborde sous les blocs courts de la frise (cosmétique, `shots/apres/fix-jour-25-1440.png`).
12. Cibles tactiles < 44 px à 390 px : liens texte « Voir l'agenda », « Tout voir », « Préparer » et « Modifier » (21 px de haut), puce `@instagram` (26 px), logo (34 px).
13. Le rail horaire affiche « 2 h » le dimanche du passage à l'heure d'été, une heure qui n'existe pas (cosmétique).
14. Une plage horaire ne peut pas finir à minuit : `24:00` ne peut pas être saisi, et `00:00` est refusé comme « fin avant début ».
15. « Suppression demandée le … » prend la date en UTC (`slice(0, 10)`) : décalage d'un jour possible entre minuit et 1-2 h.
16. Contraste AA des badges non mesuré outil en main ; Lighthouse accessibilité ≥ 90 non mesuré.

## 8. Ce qu'il manque pour une bêta avec 10 à 20 vraies pros

1. Créer le projet Supabase dédié, en région UE (décision humaine en attente depuis le 21/10), appliquer `schema.sql` et relancer les tests RLS A/B et anonymes **contre l'instance hébergée**.
2. Edge Function `book` avec Turnstile, puis retirer `anon` de `np_request_booking` et ajouter Cloudflare à la CSP.
3. Tâches planifiées : expiration des demandes, rappels et **purge des comptes à 30 jours**.
4. Configurer les e-mails Supabase Auth (confirmation et réinitialisation) en français, et tester le parcours complet sur un vrai domaine Vercel avec ses en-têtes.
5. Recette manuelle sur iPhone (Safari) et Android : réservation publique, agenda, réglages des horaires.
6. Fusion de fiches en cas de doute (F7.3) et Open Graph par pro (F8.8).
7. Compléter les modèles légaux (identité du responsable de traitement) et faire relire la politique de confidentialité.
8. Faire tourner la CI sur les branches de travail, puis mesurer Lighthouse (performance et accessibilité) en préproduction.
