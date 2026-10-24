# Audit de sécurité — NailPilot V2 (Lot 1)

**Date** : 24 octobre 2026 · **Branche** : `claude/happy-heisenberg-iqbqm0` · **Périmètre** : `supabase/schema.sql`, `src/store.js`, `src/**/*.js`, `vercel.json`, historique git, dépendances npm.

**Méthode** : revue statique du code, en local, sans connexion à Supabase ni à Vercel. Les règles SQL ont été exécutées dans PostgreSQL/WASM (PGlite) avec les rôles `anon`/`authenticated` simulés, et l'interface a été testée sous Chromium (Playwright). Aucune base hébergée n'existe encore. **Ce qui n'a pas pu être vérifié** : le comportement réel de la passerelle Supabase (en-têtes IP transmis à PostgREST, détail des erreurs renvoyées), la configuration Auth (confirmation e-mail, URL de redirection autorisées) et les en-têtes réellement servis par Vercel.

Ce rapport ne donne pas de note de conformité. Il dit ce qui a été vérifié, ce qui a été corrigé et ce qui reste à faire.

---

## 1. Synthèse

| # | Gravité | Constat | CWE | Statut |
|---|---|---|---|---|
| 1 | **Élevée** | Remplissage de l'agenda et du fichier clientes par un robot : la limite par IP est contournable et il n'existe aucun plafond par pro | CWE-770, CWE-799 | **Corrigé** |
| 2 | **Moyenne** | Usurpation d'identité d'une cliente par son seul téléphone : rattachement à sa fiche, ajout d'un e-mail, faux consentements | CWE-639, CWE-287 | **Corrigé** |
| 3 | **Moyenne** | IP de limitation lue dans la 1re valeur de `X-Forwarded-For`, que le client contrôle | CWE-348 | **Corrigé** (à vérifier sur le projet hébergé) |
| 4 | Faible | Saisies trop longues : la violation de contrainte `CHECK` renvoie la ligne en échec (avec `owner_id` et `client_id`) à `anon` ; un nom de 60 + 60 caractères faisait échouer la réservation | CWE-209, CWE-20 | **Corrigé** |
| 5 | Faible | `.ics` : un retour chariot (CR) isolé n'était pas échappé, ce qui permettait d'injecter une propriété iCalendar | CWE-93 | **Corrigé** |
| 6 | Faible | Absence de `Strict-Transport-Security` explicite et de `Cross-Origin-Opener-Policy` | CWE-319, CWE-1021 | **Corrigé** |
| 7 | Faible | Séquence `np_booking_attempts_id_seq` non révoquée (Supabase accorde par défaut les séquences à `anon`/`authenticated`) | CWE-732 | **Corrigé** (hygiène) |
| 8 | Faible | Oracle d'existence : un `NP429` dès la 1re demande révèle qu'un numéro a déjà 3 demandes en attente chez cette pro | CWE-203 | Accepté, documenté |
| 9 | Faible | CSP `connect-src https://*.supabase.co` : en cas de XSS, des données pourraient partir vers n'importe quel projet Supabase | CWE-942 | Ouvert (à restreindre quand la référence du projet sera connue) |
| 10 | Faible | Hachage `md5` non salé des téléphones et des IP dans `np_booking_attempts` : réversible par force brute (environ 10⁸ numéros mobiles) | CWE-916 | Ouvert (rétention 24 h, aucun accès client) |
| 11 | Info | `np_expire_pending` restreint le balayage au `auth.uid()` de l'appelant : si une pro connectée réserve chez une autre pro, les demandes expirées de cette dernière ne sont pas balayées, ce qui peut produire un faux `23P01` | — | Fiabilité, pas une faille |
| 12 | Info | Lien `mailto:` : un e-mail saisi en ligne peut contenir `?subject=…`, qui préremplit un sujet ou un corps quand la pro clique | CWE-88 | Accepté (aucun envoi automatique) |

**Aucun constat critique.** Aucun secret n'a été trouvé, ni dans le dépôt ni dans l'historique git. `npm audit` ne signale **aucune vulnérabilité** (dépendances de production et de développement).

---

## 2. Constats détaillés et corrections

### 2.1 [Élevée] Inondation de demandes publiques — CWE-770 / CWE-799

- **Où** : `supabase/schema.sql`, `np_request_booking`, contrôles de débit (avant correction : l. 667-677 de `HEAD`).
- **Scénario** : `np_request_booking` est exécutable par `anon`. La limite par IP se contourne en changeant `X-Forwarded-For` à chaque requête (constat 3), et la limite par téléphone en changeant de numéro, puisque tout numéro E.164 syntaxiquement valide est accepté. Aucun captcha n'existe au Lot 1. Un script de quelques lignes peut donc :
  1. réserver **tous** les créneaux d'une pro en `pending`. Chaque demande bloque son créneau jusqu'à 24 h : les vraies clientes ne trouvent plus de disponibilité, et l'attaque se renouvelle chaque jour ;
  2. créer des centaines de fausses fiches clientes (nom, téléphone, adresse) et de notifications dans le compte de la pro ;
  3. si `auto_confirm` est activé, créer des RDV **confirmés** directement.
- **Correction** : ajout de deux plafonds par pro, qui tiennent même si l'IP est falsifiée :
  - 20 demandes réussies par heure (`np_booking_attempts.owner_id`, nouvel index `np_booking_attempts_owner_idx`) ;
  - 15 demandes en ligne `pending` non expirées au maximum.

  Au-delà, la fonction renvoie `NP429`.
- **Compromis assumé** : un robot peut encore occuper au plus 15 créneaux, puis bloquer les nouvelles demandes en ligne de cette pro pendant une heure. C'est préférable à un agenda et un fichier clientes pollués. La vraie correction reste le captcha Turnstile vérifié côté serveur (Edge Function `book`, ARCHITECTURE §4.1).
- **Tests** : `audit: junk IP header is ignored, per-pro hourly cap stops phone rotation`, `audit: per-pro cap of 15 live pending online requests` (`tests/database.test.js`).

### 2.2 [Moyenne] Rattachement d'une demande à une fiche par le seul téléphone — CWE-639

- **Où** : `supabase/schema.sql`, `np_request_booking`, recherche de la fiche (désormais l. 707-716) ; miroir démo dans `src/store.js` (l. 669-671).
- **Scénario** : un inconnu qui connaît le numéro d'une cliente (un ex-conjoint, un collègue) réserve en ligne avec ce numéro et un autre nom. Avant correction :
  - la demande était rattachée à la **fiche de la vraie cliente**, et le nom saisi était ignoré : la pro voyait « Marie Dupont » demander un RDV ;
  - l'e-mail de la fiche, s'il était vide, recevait l'adresse de l'attaquant ;
  - des consentements « rappels » et « relances » étaient journalisés avec la source `online_form` au nom de la cliente, ce qui constitue une preuve de consentement fausse au sens du RGPD.
- **Correction** : la demande n'est rattachée à une fiche que si le téléphone **et** le nom correspondent (casse et espaces ignorés). Sinon, une nouvelle fiche est créée et la pro tranche, comme le prévoit la spec F7 (« en cas de doute, la pro choisit de fusionner ou créer »). La fiche existante n'est plus modifiée. Le store démo applique la même règle.
- **Effet de bord** : une cliente qui écrit son nom autrement que dans sa fiche (« Camille M. ») obtient un doublon. C'est acceptable tant qu'il n'existe pas d'outil de fusion (Lot 2).
- **Tests** : `audit: a known phone with another name never hijacks the existing client record` (SQL) et `audit: public demo booking with a known phone but another name creates a separate record` (store). Le test existant « returning client » envoie désormais le nom de la fiche.

### 2.3 [Moyenne] IP falsifiable via `X-Forwarded-For` — CWE-348

- **Où** : `np_request_booking`, déclaration `v_ip` (avant correction : l. 636 de `HEAD` ; désormais l. 639-644 et 677).
- **Scénario** : la valeur la plus à gauche de `X-Forwarded-For` est celle que le client envoie lui-même. Les proxys suivants **ajoutent** leur valeur à droite. En faisant tourner cette valeur, on obtient un quota de 5 demandes par heure illimité. On peut aussi épuiser le quota d'une IP précise (celle d'une cliente) en l'usurpant.
- **Correction** : la fonction lit d'abord `cf-connecting-ip`, que Cloudflare, placé devant Supabase, écrase. À défaut, elle lit `x-forwarded-for`. Une valeur qui n'est pas une IP (plus de 45 caractères, ou caractères hors `[0-9A-Fa-f:.]`) est ignorée. Ce n'est jamais pire qu'avant, et les plafonds par pro (§2.1) ne dépendent plus de l'IP.
- **À vérifier dès qu'un projet hébergé existera** : envoyer une requête RPC avec un faux `X-Forwarded-For` et un faux `cf-connecting-ip`, puis journaliser `current_setting('request.headers')` pour confirmer quel en-tête la passerelle réécrit. Si `cf-connecting-ip` n'est pas transmis, la limite par IP reste contournable : les plafonds par pro et le futur captcha prennent alors le relais.
- **Test** : `audit: spoofed X-Forwarded-For does not bypass the IP limit when cf-connecting-ip is present`.

### 2.4 [Faible] Erreurs de contrainte exposées à `anon` — CWE-209 / CWE-20

- **Scénario** : une adresse de plus de 200 caractères ou une ville de plus de 80 caractères atteignait les `CHECK` des tables. La fonction est `SECURITY DEFINER` et son propriétaire contourne la RLS : PostgreSQL ajoute alors au message d'erreur un `DETAIL: Failing row contains (…)`, que PostgREST renvoie au navigateur. Ce détail contient `owner_id`, `client_id` et le nom de la contrainte. Par ailleurs, prénom (≤ 60) + espace + nom (≤ 60) donnait 121 caractères, au-delà de la limite de 120 de `np_clients.name` : une saisie légitime échouait.
- **Correction** : contrôles explicites (`NP422 Adresse d'intervention trop longue.`) et nom tronqué à 120 caractères (l. 674-677, 638).
- **Test** : `audit: over-long public input is refused with NP422, never a constraint error leaking the row`.

### 2.5 [Faible] Injection dans le fichier `.ics` — CWE-93

- **Où** : `src/domain.js:649` (`icsText`).
- **Scénario** : `\r?\n` ne traitait pas un CR isolé. Un nom de prestation saisi par la pro, comme `Pose\rATTACH:http://…`, pouvait ajouter une propriété (pièce jointe, URL, alarme) dans le calendrier de la cliente, selon le lecteur `.ics`.
- **Correction** : `/\r\n|\r|\n/g` → `\n` échappé.
- **Test** : `audit: ics escapes lone CR, LF and CRLF (no property injection)` (`tests/domain.test.js`).

### 2.6 [Faible] En-têtes HTTP — CWE-319 / CWE-1021

- **Où** : `vercel.json`.
- **Correction** : ajout de `Strict-Transport-Security: max-age=63072000` (sans `includeSubDomains` ni `preload`, pour ne pas engager d'autres sous-domaines) et de `Cross-Origin-Opener-Policy: same-origin`. La CSP existante est saine : `script-src 'self'`, sans `unsafe-inline` ni `unsafe-eval`, avec `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'` et `form-action 'self'`.
- **Test** : `audit: vercel.json keeps a strict CSP and security headers`. Ce test empêche une régression de configuration. Il ne prouve pas que Vercel sert bien ces en-têtes : à vérifier avec `curl -I` sur le premier déploiement.

### 2.7 [Faible] Séquence accordée par défaut — CWE-732

- `revoke all on sequence public.np_booking_attempts_id_seq from public, anon, authenticated` (l. 293). PostgREST n'expose pas `nextval`, donc le risque réel est quasi nul : c'est de l'hygiène. Le test `audit: anon and authenticated cannot use the rate-limit sequence` passe aussi sur l'ancien schéma, car PGlite ne reproduit pas les privilèges par défaut de Supabase.

---

## 3. Points vérifiés sans anomalie

**Base de données**
- **RLS** : activée sur les 11 tables `np_*`. Toutes les politiques portent sur `owner_id = (select auth.uid())` et ciblent `to authenticated`. Aucun `USING (true)`, aucune autorisation fondée sur `user_metadata` ou sur un rôle fourni par le client. Les tests existants vérifient select, update, delete et insert entre deux pros.
- **Droits** : `revoke all … from public, anon, authenticated` sur toutes les tables, la vue et les fonctions, puis des `grant` explicites. `anon` n'a aucun droit sur les tables. Les mises à jour de `np_appointments` et `np_notifications` sont limitées colonne par colonne (`source`, `expires_at`, `anonymized_at` et `client_message` ne sont pas modifiables). Les clés étrangères composites `(id, owner_id)` empêchent de référencer la cliente ou la prestation d'une autre pro.
- **Fonctions `SECURITY DEFINER`** : toutes ont `set search_path = ''` et des noms qualifiés (`public.`, `pg_catalog` implicite). Elles ne contiennent aucun SQL dynamique, à l'exception du bloc `DO` de création des politiques, qui utilise des noms de table constants. **Aucune injection SQL possible.**
- **`np_public_page`** : ne renvoie que la vitrine (nom, ville, bio, Instagram, zone, réglages de réservation, prestations en ligne). L'adresse de base et `owner_id` ne sont pas exposés (test existant). Une page dépubliée, ou dont la suppression a été demandée, est indistinguable d'une page inexistante (`null` / `NP404`).
- **`np_available_slots`** : ne renvoie que des instants de début. Aucune cliente, aucun motif de RDV ni de fermeture n'est exposé. Une prestation hors ligne ou archivée renvoie `NP404`. La période est limitée à 31 jours. Les créneaux libres laissent deviner les plages occupées : c'est inhérent à la fonction (constat Info).
- **`np_request_booking`** : renvoie uniquement le résumé de la demande du visiteur. La ville renvoyée est celle saisie par le visiteur ou la ville publique de la pro. Aucune donnée d'une autre cliente. Le créneau est revalidé sous verrou consultatif ; les tests de concurrence existants passent.
- **`np_expire_pending`** : restreinte à l'appelant connecté et révoquée pour `anon`. `np_log_consent` (`SECURITY DEFINER`) n'est déclenchable que par trigger.

**Frontend et configuration**
- **Garde-fou de projet (`src/store.js:14-18`)** : la configuration est refusée si elle est incomplète, si la référence fait partie des trois projets interdits, si l'URL ne correspond pas à `https://<ref>.supabase.co`, ou si la référence n'a pas 20 lettres. Seule la clé **publishable** (`VITE_SUPABASE_PUBLISHABLE_KEY`) est lue. Aucune clé `service_role` n'existe dans le code.
- **XSS** : chaque interpolation dynamique de `src/**/*.js` passe par `escapeHtml` (`e()`). Les interpolations non échappées sont des constantes, des nombres calculés ou des fragments HTML déjà échappés (`icon()`, `statusBadge()`, `locationLabel()`, `addressFields()`). Les messages d'erreur passent par `textContent`. Il n'y a ni `eval`, ni `new Function`, ni gestionnaire inline. Un nouveau test e2e injecte des charges `<img onerror>` et `<svg onload>` dans le nom, la bio, une prestation, les notes, l'adresse et le message, puis vérifie la page publique, les fiches, les demandes et le tableau de bord.
- **Liens** : `wa.me` et `sms:` reçoivent un numéro normalisé E.164 et un texte passé par `encodeURIComponent`. Le lien Maps est encodé. `tel:` reçoit un E.164 validé en base. Le lien Instagram est encodé et validé par expression régulière. Tous les `target="_blank"` ont `rel="noopener"`.
- **CSV** : les cellules commençant par `= + - @ TAB CR` sont neutralisées et les séparateurs `,` et `;` sont entre guillemets, y compris pour Excel en français.
- **Routeur** : la redirection `#/r/…` vers `location.assign('/r/…')` reste sur la même origine : aucune redirection ouverte. Un `decodeURIComponent` invalide est affiché via `textContent`.
- **Secrets** : aucun dans les 8 commits de l'historique (recherche de clés `sk-`, `sb_secret_`, JWT, `service_role`, clés privées, `ghp_`, `AKIA`). `.env*` est ignoré par git, sauf `.env.example`, qui est vide. Les téléphones présents dans l'historique sont des numéros fictifs de test. La CI utilise `persist-credentials: false` et des actions épinglées par SHA.
- **Dépendances** : `npm audit` ne signale aucune vulnérabilité. Les versions sont exactes dans `package.json`.

---

## 4. Risques restants et actions recommandées

1. **Captcha Turnstile avant toute ouverture publique** (bloquant pour la production). Créer l'Edge Function `book`, qui vérifie le jeton puis appelle `np_request_booking` en `service_role`. Retirer alors `anon` de `np_request_booking` et ajouter `challenges.cloudflare.com` à la CSP. Les plafonds par pro (20/h, 15 en attente) pourront ensuite être relevés.
2. **Vérifier les en-têtes IP sur le projet hébergé** (§2.3) et les en-têtes HTTP servis par Vercel (`curl -I`).
3. **Restreindre `connect-src`** à `https://<ref>.supabase.co` (et `wss://`) dès que la référence du projet sera connue.
4. **Configuration Supabase Auth** : confirmation e-mail obligatoire, protection contre les mots de passe divulgués, liste blanche des URL de redirection limitée au domaine de production (`/#/connexion`, `/#/mot-de-passe`), limites de débit Auth par défaut conservées.
5. **Hachage des clés de limitation** : remplacer `md5('np-phone:'||…)` par un HMAC avec un secret stocké dans Supabase Vault (rétention actuelle : 24 h).
6. **Purge des comptes** (`deletion_requested_at` + 30 j) : le job `service_role` est encore manuel. La suppression effective doit être tracée.
7. **Oracle des 3 demandes en attente (§1, n° 8)** : il ne révèle qu'un nombre de demandes en attente pour un numéro donné, et seulement s'il est déjà atteint. Il disparaîtra largement avec le captcha.
8. **Jeton de session dans `localStorage`** (comportement par défaut de supabase-js) : une XSS permettrait de le voler. Le risque est contenu par la CSP stricte et l'échappement systématique ; à garder en tête si la CSP est un jour assouplie.
9. **Usurpation résiduelle** : quelqu'un qui connaît à la fois le nom **et** le téléphone d'une cliente peut encore compléter son e-mail vide et ajouter un consentement. Le journal garde la source `online_form` et l'horodatage, ce qui permet de contester. À traiter avec la vérification par SMS (hors Lot 1).

---

## 5. Fichiers modifiés

| Fichier | Modification |
|---|---|
| `supabase/schema.sql` | `np_request_booking` : IP via `cf-connecting-ip`, validation de l'IP, bornes de longueur, plafonds par pro, rattachement téléphone + nom ; index `np_booking_attempts_owner_idx` ; révocation de la séquence |
| `src/store.js` | Miroir démo du rattachement téléphone + nom |
| `src/domain.js` | `icsText` : échappement de CR, LF et CRLF |
| `vercel.json` | `Strict-Transport-Security`, `Cross-Origin-Opener-Policy` |
| `docs/ARCHITECTURE.md` | §4.1 : règle de rattachement et limites de débit |
| `tests/database.test.js` | 6 tests `audit:` ; test « returning client » aligné sur la nouvelle règle |
| `tests/domain.test.js` | Tests `.ics` et en-têtes Vercel |
| `tests/store.test.js` | Test de rattachement démo |
| `tests/e2e/app.spec.js` | Test XSS sur 5 écrans (bureau et téléphone) |

**Vérification** : `npm test` donne 95 réussis sur 95, `npm run build` réussit, `npm run test:e2e` donne 12 réussis sur 12. Les 5 nouveaux tests SQL de comportement échouent sur le schéma d'origine et passent sur le schéma corrigé.
