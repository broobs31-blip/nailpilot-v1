# NailPilot V2 — Spécification produit

**Statut** : brouillon, à relire · **Date** : 24 octobre 2026 · **Base** : MVP V1 (`codex/nailpilot-mvp`, rapport du 21/10/2026)
**Ambition** : devenir l'outil de référence des professionnelles de la beauté **à domicile** en France (ongles, coiffure, maquillage).

---

## 1. Problème et positionnement

Les pros indépendantes à domicile gèrent leurs rendez-vous via Instagram, WhatsApp et un carnet papier. Les outils du marché (Planity, Treatwell, Booksy…) pensent « salon avec adresse fixe » : ils ignorent le **déplacement chez la cliente**, le **temps de trajet** entre deux prestations et le **lien en bio Instagram** comme canal n°1 d'acquisition.

**Communiqué (version courte)** : « Avec NailPilot, une prothésiste, coiffeuse ou maquilleuse à domicile partage un lien dans sa bio Instagram. Ses clientes choisissent une prestation, indiquent si elles viennent ou si la pro se déplace, et ne voient que les créneaux vraiment faisables, trajet compris. Fini les allers-retours en DM et les retards en chaîne. »

**Différenciateurs** : (1) gestion native du lieu et des tampons de trajet ; (2) réservation pensée pour Instagram, mobile d'abord ; (3) multi-métiers avec catalogues pré-remplis ; (4) simplicité — une pro seule, pas un salon.

**Non-objectifs V2** : gestion multi-employées, caisse/stock, marketplace d'annuaire, application native iOS/Android (PWA en Lot 2).

---

## 2. Personas et journées types

### 2.1 Inès, 29 ans — prothésiste ongulaire (Toulouse)
- Travaille dans une pièce aménagée chez elle, 80 % des clientes viennent à elle, 20 % se déplace (mariages, clientes âgées).
- 6 à 8 RDV/jour, durées 45 min (semi-permanent) à 2 h (pose complète). 70 % de clientes récurrentes (remplissage toutes les 3-4 semaines).
- Acquisition : Instagram (2 500 abonnés), bouche-à-oreille.
- **Journée type** : 8 h 30 répond aux DM de la nuit (« t'as une dispo samedi ? ») ; 9 h-12 h 3 clientes ; pause ; 13 h 30-19 h 4 clientes ; le soir, envoie les rappels du lendemain un par un par SMS. Douleurs : DM chronophages, lapins (1 à 2/semaine), oublis de relance remplissage.

### 2.2 Sofia, 35 ans — coiffeuse à domicile (périphérie de Lyon)
- 100 % en déplacement chez la cliente, en voiture, rayon ~25 km.
- 4 à 6 RDV/jour, durées très variables (coupe 45 min, couleur + coupe 2 h 30, mèches 3 h). Clientèle familiale (une mère + 2 enfants à la même adresse).
- **Journée type** : 8 h charge le coffre ; enchaîne Villeurbanne → Bron → Vénissieux ; perd 20-40 min de trajet entre chaque cliente, souvent mal estimé → retards. Le soir, recale sa semaine sur Google Agenda. Douleurs : trajets non anticipés, clientes qui réservent un créneau impossible géographiquement, adresses/codes d'accès perdus dans les SMS.

### 2.3 Léa, 26 ans — maquilleuse (Paris / Île-de-France)
- Mix : studio partagé chez elle pour les essais, déplacement pour événements (mariages, shootings), souvent très tôt (5 h 30 le samedi).
- Volume irrégulier : 0 à 3 RDV en semaine, pics le week-end ; réservations parfois 6 à 10 mois à l'avance (mariages).
- **Journée type (samedi mariage)** : départ 5 h, 3 h sur place (mariée + 4 demoiselles), retouches, retour. En semaine : essais maquillage, réponses aux devis Instagram. Douleurs : réservations hors horaires habituels, annulations tardives coûteuses (acompte souhaité), besoin d'un délai de réservation minimum (pas de RDV demandé la veille pour le lendemain 6 h).

---

## 3. Fonctionnalités priorisées (MoSCoW) et lots

| # | Fonctionnalité | MoSCoW | Lot |
|---|---|---|---|
| F1 | Authentification Supabase (inscription, connexion, mot de passe oublié) | Must | 1 |
| F2 | Profil pro : métier(s), nom commercial, adresse de base, zone, slug public | Must | 1 |
| F3 | Horaires d'ouverture hebdomadaires + fermetures exceptionnelles | Must | 1 |
| F4 | Catalogue de prestations personnalisable (durée, prix, lieu autorisé), pré-rempli par métier | Must | 1 |
| F5 | Agenda jour + semaine (créer, déplacer, annuler, statuts) | Must | 1 |
| F6 | Gestion du lieu (chez la pro / chez la cliente) + tampon de trajet | Must | 1 |
| F7 | Fiches clientes (reprise V1 + adresse + infos d'accès) | Must | 1 |
| F8 | Page publique de réservation (lien Instagram) avec créneaux disponibles | Must | 1 |
| F9 | Validation des demandes de RDV en ligne (auto ou manuelle) | Must | 1 |
| F10 | Rappels 24 h préparés (copie manuelle, lien WhatsApp/SMS pré-rempli) | Must | 1 |
| F11 | Relances de remplissage/entretien (reprise V1, généralisée multi-métiers) | Should | 1 |
| F12 | RGPD : mentions, export et suppression d'une cliente | Must | 1 |
| F13 | Notifications e-mail transactionnelles (confirmation/annulation, via Supabase/Resend) | Should | 2 |
| F14 | Vue mois + récurrences, liste d'attente | Should | 2 |
| F15 | Estimation du trajet par géocodage (distance réelle, API cartographique) | Should | 2 |
| F16 | Annulation/report par la cliente via lien sécurisé | Should | 2 |
| F17 | PWA installable + notifications push pour la pro | Should | 2 |
| F18 | Statistiques (CA prévu/réalisé, taux de lapins, top prestations) | Could | 2 |
| F19 | Synchronisation Google Agenda / iCal (export puis bidirectionnel) | Could | 2 |
| F20 | Photos avant/après (galerie portfolio, consentement image) | Could | 2 |
| F21 | Envoi SMS automatique payant (prestataire FR, crédits) | Must (commercial) | 3 |
| F22 | Acomptes et empreinte bancaire Stripe Connect, politique de no-show | Should | 3 |
| F23 | Abonnement NailPilot (Stripe Billing, essai 14 j) | Must (commercial) | 3 |
| F24 | Optimisation de tournée (regroupement géographique des créneaux proposés) | Could | 3 |
| F25 | Forfaits/devis événementiels (mariage multi-personnes) | Could | 3 |
| F26 | Fidélité, cartes cadeaux, avis clientes | Won't (V2) | — |
| F27 | Multi-employées / salon | Won't (V2) | — |

**Lot 1** = un produit utilisable gratuitement en bêta par une pro réelle, sans aucun service payant. **Lot 2** = confort et rétention. **Lot 3** = monétisation et réduction des lapins.

---

## 4. Lot 1 — user stories et critères d'acceptation

Convention : « pro » = utilisatrice authentifiée ; « cliente » = visiteuse anonyme de la page publique. Toutes les heures sont affichées et saisies en Europe/Paris, stockées en `timestamptz`.

### F1 — Authentification
**Story** : En tant que pro, je veux créer mon compte seule avec mon e-mail pour commencer sans attendre une invitation.
- [ ] Inscription e-mail + mot de passe (≥ 8 caractères) via Supabase Auth ; e-mail de confirmation exigé avant le premier accès à l'agenda.
- [ ] Connexion, déconnexion, « mot de passe oublié » (lien de réinitialisation) fonctionnent ; session persistée au rechargement.
- [ ] Message d'erreur en français et générique (« Identifiants incorrects ») — ne révèle pas l'existence d'un compte.
- [ ] Deux comptes A et B : A ne lit ni ne modifie aucune ligne de B (test RLS automatisé sur chaque table) ; un anonyme n'accède à aucune table privée.
- [ ] Après la première connexion, redirection vers l'assistant de profil (F2) tant que le profil est incomplet.
- [ ] Le mode démonstration local V1 reste disponible sans Supabase, clairement signalé.

### F2 — Profil pro et métier
**Story** : En tant que pro, je veux renseigner mon métier et mon activité pour obtenir un catalogue et une page publique adaptés.
- [ ] Assistant en 3 étapes max : métier(s) (ongles / coiffure / maquillage, multi-choix), nom commercial + ville, mode de travail (chez moi / à domicile / les deux).
- [ ] Si « chez moi » : adresse de base obligatoire, affichée à la cliente **seulement après confirmation** du RDV (jamais sur la page publique, seulement la ville).
- [ ] Si « à domicile » : zone d'intervention (liste de codes postaux ou rayon en km déclaratif) et tampon de trajet par défaut (voir R1).
- [ ] Slug public unique, 3-40 caractères `[a-z0-9-]`, proposé à partir du nom commercial, modifiable ; refus des slugs réservés (`admin`, `api`, `login`…).
- [ ] Champs publics (nom, bio ≤ 300 caractères, lien Instagram) et privés séparés dans des tables distinctes ; la vue publique n'expose que les premiers.

### F3 — Horaires d'ouverture et fermetures
**Story** : En tant que pro, je veux définir mes horaires et mes congés pour que seuls des créneaux réels soient proposés.
- [ ] Pour chaque jour de la semaine : fermé, ou 1 à 3 plages (ex. 9 h-12 h, 13 h 30-19 h) ; plages non chevauchantes, fin > début.
- [ ] Fermetures exceptionnelles (date ou période, journée entière ou plage) ; elles priment sur les horaires.
- [ ] Une modification des horaires n'annule ni ne déplace aucun RDV existant ; un RDV hors horaires reste visible avec un badge « hors horaires ».
- [ ] La pro peut toujours créer manuellement un RDV hors horaires (après confirmation explicite).

### F4 — Catalogue de prestations
**Story** : En tant que pro, je veux gérer mes prestations avec durée et prix pour que mes clientes réservent la bonne durée.
- [ ] Catalogue pré-rempli selon le métier choisi (ex. ongles : Pose complète 2 h/55 €, Remplissage 1 h 30/40 € ; coiffure : Coupe femme 45 min/35 €, Couleur 1 h 30 ; maquillage : Essai mariée 1 h 30, Mariée jour J 1 h 30), entièrement modifiable/supprimable.
- [ ] Champs : nom (1-80), catégorie, durée (15 min à 8 h, pas de 5 min), prix en euros TTC (0 à 2 000, centimes) ou « sur devis », description ≤ 300, lieux autorisés (chez la pro / chez la cliente / les deux), visible en ligne oui/non, temps de préparation après (0-60 min), délai de relance conseillé (7-90 j, optionnel).
- [ ] Réordonnancement par glisser ou flèches ; ordre reflété sur la page publique.
- [ ] Archivage d'une prestation : elle disparaît de la réservation mais reste affichée sur les RDV passés (nom, durée, prix figés au moment du RDV).
- [ ] La liste fermée V1 (`check service in (...)`) est remplacée par une référence au catalogue + instantané texte.

### F5 — Agenda jour + semaine
**Story** : En tant que pro, je veux voir ma journée et ma semaine pour organiser mes déplacements d'un coup d'œil.
- [ ] Vue jour (défaut sur mobile) et vue semaine (défaut sur ≥ 768 px), bascule mémorisée ; navigation précédent/suivant/aujourd'hui.
- [ ] Sur mobile (390 px), vue semaine lisible sans défilement horizontal : 7 colonnes compactes ou liste par jour.
- [ ] Chaque RDV affiche : heure, cliente, prestation(s), icône lieu (maison / voiture), ville si chez la cliente, statut ; le tampon de trajet est représenté en hachuré avant/après.
- [ ] Statuts : `pending` (demande en ligne), `booked`, `done`, `cancelled`, `no_show` ; couleur et libellé distincts, contraste AA.
- [ ] Création rapide en touchant un créneau libre ; déplacement via formulaire (le glisser-déposer est un plus, non requis).
- [ ] Contrôle de chevauchement **tampons inclus** côté interface et côté base (contrainte d'exclusion sur la plage bloquée).
- [ ] Plages fermées grisées ; heures correctes les jours de changement d'heure (tests existants V1 conservés).

### F6 — Lieu et tampon de trajet
**Story** : En tant que pro qui se déplace, je veux que chaque RDV porte son lieu et que mon temps de trajet soit bloqué pour ne plus être en retard.
- [ ] Chaque RDV a un lieu : `pro` (adresse de base) ou `client` (adresse saisie : rue, CP, ville, complément/digicode).
- [ ] Une prestation n'est réservable qu'aux lieux qu'elle autorise ; un CP hors zone d'intervention est refusé en ligne avec un message clair (la pro peut forcer manuellement).
- [ ] Le RDV stocke `starts_at`/`ends_at` (prestation) et `block_start`/`block_end` (avec tampons) ; c'est la plage bloquée qui sert aux conflits.
- [ ] Tampon appliqué selon R1 ; modifiable manuellement par RDV dans l'agenda (0-120 min).
- [ ] Le détail du RDV propose « Ouvrir dans Maps » (lien `geo:`/Google Maps) pour l'adresse cliente.

### F7 — Fiches clientes
**Story** : En tant que pro, je veux retrouver coordonnées, adresse et préférences de chaque cliente pour personnaliser mon service.
- [ ] Reprise intégrale V1 : recherche, coordonnées E.164, préférences, consentements rappels/relances séparés et non précochés, historique, archivage.
- [ ] Ajout : adresse(s) d'intervention (1 principale + autres), infos d'accès, prénom d'usage, source (Instagram, bouche-à-oreille, en ligne).
- [ ] Une réservation en ligne crée ou rattache la fiche (correspondance sur téléphone normalisé **et** même propriétaire) ; en cas de doute, la pro choisit de fusionner ou créer.
- [ ] Le champ notes affiche l'avertissement R7 (pas de données de santé).
- [ ] Export JSON/CSV d'une fiche + historique, et suppression définitive (anonymisation des RDV passés) — voir F12.

### F8 — Page publique de réservation
**Story** : En tant que cliente venant d'Instagram, je veux réserver en moins d'une minute depuis mon téléphone sans créer de compte.
- [ ] URL `/<slug>` accessible sans authentification ; bouton « Copier mon lien » et aperçu dans l'app pro.
- [ ] Parcours en 4 écrans max : prestation → lieu (et adresse si à domicile) → jour/créneau → coordonnées (prénom, nom, téléphone, e-mail optionnel, message ≤ 300) + cases de consentement non précochées + lien vers la politique de confidentialité.
- [ ] Seuls sont proposés les créneaux qui respectent : horaires (F3), fermetures, RDV existants **tampons compris**, délais min/max (R3), pas de grille (R4).
- [ ] Les créneaux sont calculés côté serveur (fonction SQL `SECURITY DEFINER` restreinte ou Edge Function) ; la page ne reçoit **que** des heures de début libres, jamais les RDV ni identités des autres clientes.
- [ ] La création est atomique : si le créneau a été pris entre-temps, message « Ce créneau vient d'être réservé » et retour à la liste actualisée.
- [ ] Anti-abus : captcha léger (Turnstile gratuit ou équivalent) + limite 5 demandes/heure par téléphone et par IP ; champ « pot de miel ».
- [ ] Écran de confirmation : récapitulatif, statut (« en attente de validation » ou « confirmé »), ajout au calendrier (.ics).
- [ ] Performance : page interactive < 2,5 s en 4G ; Lighthouse accessibilité ≥ 90 ; balises Open Graph pour l'aperçu Instagram.
- [ ] La page affiche ville, prestations visibles, prix ou « sur devis », jamais l'adresse exacte de la pro.

### F9 — Validation des demandes
**Story** : En tant que pro, je veux choisir si les réservations sont confirmées automatiquement ou après mon accord.
- [ ] Réglage global : « confirmation automatique » ou « je valide chaque demande » (défaut : je valide).
- [ ] Une demande `pending` bloque le créneau pendant 24 h max (R5) ; badge compteur dans la navigation.
- [ ] Accepter → `booked` ; refuser → `cancelled` avec motif optionnel ; dans les deux cas un message prêt à copier (SMS/WhatsApp) est généré.
- [ ] Sans action sous 24 h, la demande expire, le créneau se libère et la pro en est informée dans l'app.

### F10 — Rappels préparés
**Story** : En tant que pro, je veux que mes rappels du lendemain soient prêts pour les envoyer en quelques secondes.
- [ ] Reprise V1 : suggestion 24 h avant pour les RDV `booked` avec consentement ; invalidation si annulé/déplacé/consentement retiré.
- [ ] Message adapté au lieu : « chez moi, [ville] » ou « je viendrai chez vous au [adresse] » ; modèles modifiables par la pro avec variables `{prenom} {date} {heure} {prestation} {adresse}`.
- [ ] Boutons « Copier », « Ouvrir SMS » (`sms:` pré-rempli) et « Ouvrir WhatsApp » (`wa.me` pré-rempli) ; « traité » ne signifie jamais « envoyé ».
- [ ] Messages de confirmation (F9) et de relance (F11) utilisent le même moteur de modèles.

### F11 — Relances de remplissage/entretien
- [ ] Reprise V1, mais le délai provient de la prestation (F4) à défaut de la fiche cliente ; désactivable par prestation (ex. maquillage mariée).
- [ ] Le message de relance contient le lien de réservation publique.

### F12 — Conformité RGPD (socle)
- [ ] Pages « Politique de confidentialité » et « Mentions légales » liées depuis la page publique et l'app (modèle à compléter par la pro pour son identité de responsable de traitement).
- [ ] Export de toutes les données du compte pro (JSON) et suppression du compte (avec confirmation, effacement sous 30 j).
- [ ] Journal minimal des consentements (date, source : saisie pro / formulaire en ligne).

---

## 5. Règles métier clés

**R1 — Tampons de trajet.**
- RDV chez la pro : tampon avant = 0, tampon après = temps de préparation de la prestation (défaut 10 min, nettoyage/désinfection).
- RDV chez la cliente : tampon avant = tampon après = trajet par défaut du profil (défaut 30 min, 0-120). Lot 1 : valeur déclarative ; Lot 2 : estimation par distance.
- Entre deux RDV consécutifs chez des clientes, les tampons ne se cumulent pas au-delà du plus grand des deux (le trajet A→B est compté une fois) : l'écart minimal entre fin de A et début de B = max(tampon après A, tampon avant B).
- Un tampon peut déborder hors des horaires d'ouverture (le trajet aller du premier RDV peut commencer avant l'ouverture), mais la **prestation** doit tenir dans une plage ouverte.

**R2 — Horaires.** Un créneau en ligne est valide si [début, fin de prestation] est entièrement inclus dans une plage ouverte du jour, hors fermeture exceptionnelle. Calcul en heure locale Europe/Paris ; un créneau tombant dans l'heure inexistante du passage à l'heure d'été n'est pas proposé.

**R3 — Délais de réservation.** Délai minimum avant RDV : réglable 0 h-7 j (défaut 12 h). Horizon maximum : 1 semaine-12 mois (défaut 2 mois ; une maquilleuse peut ouvrir 12 mois). Hors de ces bornes, aucun créneau n'est affiché.

**R4 — Grille de créneaux.** Pas de proposition : 15, 30 ou 60 min (défaut 30). Les débuts proposés sont alignés sur la grille à partir du début de plage.

**R5 — Demandes en attente.** Une demande `pending` bloque son créneau ; expiration automatique après 24 h ou à l'heure du RDV moins le délai minimum, selon la première échéance. Plafond : 3 demandes en attente par téléphone et par pro.

**R6 — Annulation.**
- La pro peut annuler à tout moment (motif optionnel) ; le créneau est libéré immédiatement ; un message prêt à copier est proposé.
- Lot 1 : la cliente annule en contactant la pro (pas de lien d'annulation self-service). Lot 2 : lien sécurisé, autorisé jusqu'à un délai d'annulation réglable (défaut 24 h) ; au-delà, contact direct.
- `no_show` est un statut distinct d'`cancelled`, saisissable par la pro après l'heure du RDV ; compteur visible sur la fiche (base des acomptes Lot 3).
- Un RDV `done` ou `no_show` ne peut plus être annulé ; un RDV passé ne peut être déplacé.

**R7 — Notes et données sensibles.** Les notes et préférences sont réservées aux informations de service (forme, couleur, longueur, technique). Avertissement permanent sous le champ : « N'indiquez aucune information de santé (allergies, grossesse, traitements, pathologies). » Les allergies éventuelles relèvent d'une décision juridique ultérieure (consentement explicite art. 9 RGPD) — hors périmètre V2.

**R8 — Unicité et intégrité.** Aucune plage bloquée (tampons inclus) ne se chevauche pour une même pro hors `cancelled` (contrainte GiST étendue) ; les prix et durées sont figés sur le RDV au moment de la réservation.

---

## 6. Contraintes transverses

- **Mobile-first** : conception à 390 px puis élargissement ; cibles tactiles ≥ 44 px ; tests Chromium mobile + au minimum un test manuel Safari iOS avant bêta.
- **Langue** : 100 % français, formats FR (`samedi 14 nov., 9 h 30`, `55,00 €`), téléphones saisis en national et stockés en E.164.
- **Fuseau** : Europe/Paris partout (affichage, calcul de créneaux, rappels) ; tests sur les dimanches de changement d'heure.
- **RGPD** : minimisation (pas de date de naissance, pas de santé), RLS sur chaque table, accès anonyme limité à la vue publique et aux fonctions de créneaux/réservation, consentements séparés et non précochés, export/suppression, hébergement UE (région Supabase Europe).
- **Sécurité** : clé publishable uniquement côté client ; aucune `service_role` dans le front ; échappement des champs saisis par les clientes ; rate limiting sur la réservation.
- **Coût** : Lot 1 sans service payant (Supabase gratuit dédié, Vercel preview) ; tout service payant (SMS, Stripe, cartographie) exige une validation explicite.
- **Accessibilité** : WCAG 2.1 AA visé sur la page publique.

---

## 7. Données — évolutions de schéma (Lot 1)

| Table | Rôle | Accès anonyme |
|---|---|---|
| `np_profiles` (privé) | métier(s), adresse de base, réglages R1-R5, mode validation | non |
| `np_public_profiles` | slug, nom commercial, ville, bio, Instagram | lecture |
| `np_opening_hours`, `np_closures` | horaires et fermetures | non (via fonction) |
| `np_services` | catalogue (durée, prix en centimes, lieux, visible) | lecture des prestations visibles |
| `np_clients` | + adresses, accès, source | non |
| `np_appointments` | + `service_id`, instantané nom/durée/prix, `location_type`, adresse, `block_start/end`, statuts `pending`/`no_show`, `source` (pro/online) | non (création via fonction) |
| `np_notifications` | + kind `confirmation` | non |

Fonctions exposées à `anon` : `np_available_slots(slug, service_id, location, from, to)` et `np_request_booking(...)`, avec validation complète côté serveur (R1-R5) et sans fuite de données.

---

## 8. Indicateurs de succès (bêta Lot 1, 60 jours, 10-20 pros)

| Objectif | Indicateur | Cible |
|---|---|---|
| Activation | % de pros inscrites ayant profil + catalogue + lien partagé sous 48 h | ≥ 60 % |
| Valeur réservation | Part des RDV créés via la page publique | ≥ 30 % à J60 |
| Fiabilité trajets | RDV en conflit signalés par les pros | 0 bug de chevauchement |
| Rétention | Pros actives (≥ 3 RDV/semaine) à S8 | ≥ 50 % |
| Signal Lot 3 | Pros déclarant vouloir payer pour SMS/acomptes | ≥ 40 % |

---

## 9. Lot 2 et Lot 3 — synthèse

**Lot 2 (confort, rétention — ~4-6 semaines)** : e-mails transactionnels, annulation/report self-service, vue mois et RDV récurrents, liste d'attente, estimation de trajet par géocodage (Base Adresse Nationale gratuite + durée estimée), PWA + push, statistiques, export iCal puis sync Google, photos portfolio avec consentement image.

**Lot 3 (monétisation)** : SMS automatiques via prestataire français (crédits refacturés, STOP obligatoire, journal d'envoi, déduplication), acomptes/empreinte bancaire Stripe Connect avec politique d'annulation affichée et acceptée, abonnement NailPilot (Stripe Billing), optimisation de tournée (proposer en priorité les créneaux proches géographiquement des RDV existants), devis/forfaits événementiels multi-personnes.

---

## 10. Risques et questions ouvertes

| Risque / question | Impact | Mitigation / propriétaire |
|---|---|---|
| Fuite de données via la page publique | Élevé | Fonctions dédiées, tests anonymes automatisés, revue des conseillers Supabase |
| Spam de réservations | Moyen | Captcha, rate limit, validation manuelle par défaut |
| Tampon fixe imprécis en zone dense | Moyen | Override par RDV en Lot 1, géocodage en Lot 2 |
| Projet Supabase hébergé toujours non créé | Bloquant pour la bêta | Décision humaine sur l'organisation (voir rapport 21/10) |
| Statut juridique des allergies (coloration, résines) | Moyen | Avis juridique avant toute collecte ; exclu de la V2 |
| Renommage (« NailPilot » restrictif en multi-métiers) | Faible | Question marketing ouverte, hors Lot 1 |
