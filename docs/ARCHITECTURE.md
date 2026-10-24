# NailPilot V2 — Architecture du Lot 1

**Statut** : accepté pour le Lot 1 · **Date** : 24 octobre 2026 · **Périmètre** : F1 à F12, règles R1 à R8 (`docs/SPEC-PRODUIT-V2.md`)

Ce document est le **contrat** entre deux développeurs qui travaillent en parallèle :

- **Backend** : base de données, logique métier pure et couche d'accès aux données ;
- **Frontend** : écrans, routage, styles et parcours e2e.

Le Frontend ne lit et n'écrit **que** par `src/store.js`. Il utilise `src/domain.js` pour la logique pure (formatage, validation, calcul des créneaux en démo). Il n'appelle jamais Supabase directement.

---

## 1. ADR-001 — Garder Vite + JavaScript vanilla

**Contexte.** La V1 compte environ 350 lignes de code applicatif, sans dépendance UI. Ses tests sont fiables : domaine, SQL réel dans PGlite et e2e Chromium. La CSP est stricte (`script-src 'self'`, pas d'inline). L'équipe compte deux développeurs, et aucune base hébergée n'existe encore.

**Décision.** On garde Vite 8 + JS vanilla (modules ES). On découpe `src/app.js` en routeur, vues et composants. Pas de framework ni de TypeScript au Lot 1 : des JSDoc portent les types du contrat.

**Justification (5 lignes).**
1. Le risque principal du Lot 1 est le **métier et la sécurité** (créneaux, tampons, RLS), pas le rendu UI. Une migration ne réduit ni l'un ni l'autre.
2. On conserve les tests existants et la CSP. Il n'y a pas de toolchain JSX à sécuriser, et la page publique reste légère (objectif < 2,5 s en 4G).
3. Le contrat `domain.js`/`store.js` isole déjà la logique. Un futur passage à Preact ou Svelte ne réécrira que les vues.
4. Le coût est connu : il faut des conventions de rendu strictes (échappement systématique via `escapeHtml`, une fonction `bind` par vue). Elles sont décrites au §3.
5. **Réversibilité** : si les vues dépassent environ 3 000 lignes ou exigent un état local complexe (glisser-déposer agenda), on rouvrira la question au Lot 2 (ADR-002).

**Conséquences.** Plus simple : build, CSP, onboarding, tests. Plus difficile : réactivité fine (re-render complet de la vue courante, acceptable à ce volume) et composants réutilisables (simples fonctions `html` + `bind`).

---

## 2. ADR-002 — Créneaux et réservation côté serveur, tampons « au plus grand »

**Contexte.** La règle R1 impose : écart minimal entre A et B = max(tampon après A, tampon avant B). Une contrainte GiST sur la seule « plage bloquée » imposerait la **somme** des tampons, soit 60 min au lieu de 30 entre deux domiciles. Sofia perdrait 30 min à chaque transition.

**Décision.**
- Chaque RDV stocke une plage de prestation `[starts_at, ends_at)` et une plage bloquée `[block_start, block_end)`, dérivées par trigger.
- Deux RDV vivants A et B sont en conflit si `A.bloquée && B.prestation` **ou** `A.prestation && B.bloquée`.
- Filet dur : exclusion GiST sur la plage de prestation. Règle des tampons : trigger `np_appointment_rules` sous verrou consultatif par pro (`pg_advisory_xact_lock`), ce qui évite toute course en READ COMMITTED. Les deux lèvent `23P01`.
- La page publique n'accède à **aucune table**. Elle passe par trois fonctions `SECURITY DEFINER` (§4). `np_request_booking` revalide le créneau en rappelant `np_available_slots` après le verrou : une seule source de vérité.

**Conséquences.** Les conflits sont exacts et sans course. Le trigger coûte une requête indexée par écriture, ce qui est négligeable pour une pro seule. La règle est dupliquée dans `domain.js` (démo et pré-contrôle UI) : les tests domaine **doivent** couvrir les mêmes cas que les tests SQL.

---

## 3. Découpage du frontend (propriété Frontend)

```
index.html                 point d'entrée unique (inchangé : /src/app.js)
src/app.js                 bootstrap : createStore(), router.start(), shell (sidebar, bannière démo, notice)
src/router.js              routeur : hash pour l'app pro, chemin /r/<slug> pour la page publique
src/views/
  auth.js                  connexion, inscription, mot de passe oublié/réinitialisation (F1)
  onboarding.js            assistant 3 étapes (F2) + choix du catalogue pré-rempli (F4)
  agenda-day.js            vue jour (F5, F6)
  agenda-week.js           vue semaine (F5)
  appointment-dialog.js    création/modification/statuts d'un RDV, lien Maps (F5, F6)
  requests.js              demandes en ligne pending : accepter/refuser (F9)
  clients.js               liste + fiche cliente, adresses, export, suppression (F7, F12)
  services.js              catalogue, réordonnancement, archivage (F4)
  settings.js              profil public/privé, horaires, fermetures, réservation (R3-R5), modèles, compte (F2, F3, F12)
  messages.js              rappels, relances, confirmations à copier/SMS/WhatsApp (F10, F11)
  public-booking.js        page publique (F8), chargée par import() dynamique
  legal.js                 confidentialité + mentions légales (F12)
src/components/            fonctions pures → HTML échappé + bind(root)
  dialog.js, notice.js, slot-picker.js, appointment-card.js, status-badge.js, address-fields.js, message-actions.js
src/style.css              styles (mobile d'abord, 390 px)
```

**Routes.**

| Route | Vue | Auth |
|---|---|---|
| `#/connexion`, `#/inscription`, `#/mot-de-passe` | auth | non |
| `#/bienvenue` | onboarding (forcé tant que `store.needsOnboarding`) | oui |
| `#/agenda/jour/AAAA-MM-JJ`, `#/agenda/semaine/AAAA-MM-JJ` | agenda | oui |
| `#/demandes` | requests | oui |
| `#/clientes`, `#/clientes/<id>` | clients | oui |
| `#/prestations` | services | oui |
| `#/messages/rappels`, `#/messages/relances` | messages | oui |
| `#/reglages/profil` / `horaires` / `reservation` / `compte` | settings | oui |
| `/r/<slug>` (et `#/r/<slug>` en repli) | public-booking | **non** |
| `#/confidentialite`, `#/mentions-legales` | legal | non |

**Décision : page publique sous `/r/<slug>`**, et non sous `/<slug>` à la racine. On évite toute collision avec les routes et fichiers statiques. Une seule règle de réécriture Vercel suffit : `{"source": "/r/:slug", "destination": "/index.html"}`. Vite sert déjà `index.html` en développement. Le routeur lit d'abord `location.pathname`, puis `location.hash`. La vue publique est chargée par `import()` : le bundle pro n'est pas téléchargé par les clientes. `store.js` expose `createPublicApi()` pour ne pas charger l'état pro.

**Conventions de rendu (obligatoires).**
- Toute donnée dynamique passe par `escapeHtml` avant interpolation. Aucune donnée cliente ne va dans un attribut sans échappement.
- Chaque vue exporte `render(ctx) → string` et `bind(root, ctx) → void`. `ctx = { store, route, navigate, notice }`.
- Aucun `style=""` ni gestionnaire inline (CSP).
- Les erreurs du store sont des `Error` avec un message français prêt à afficher et un `code` stable (§6.3).

---

## 4. Schéma de données (propriété Backend) — `supabase/schema.sql`

Toutes les tables portent le préfixe `np_` et ont RLS activé. `owner_id = auth.uid()` pour `authenticated`. `anon` n'a aucun droit sur les tables. Les montants sont en centimes, les heures en `timestamptz`. Les horaires sont exprimés en minutes depuis minuit, heure de Paris.

| Table | Rôle | Points clés |
|---|---|---|
| `np_profiles` | Réglages privés de la pro (PK `owner_id`) | `trades[]` (`nails`/`hair`/`makeup`), `work_mode` (`home_studio`/`mobile`/`both`), adresse de base, `zone_postal_codes[]`/`zone_radius_km`, `travel_buffer_min` (30), `min_notice_min` (720), `max_horizon_days` (60), `slot_step_min` (15/30/60), `auto_confirm`, 4 modèles de message (vide = défaut `domain.js`), `onboarded_at`, `deletion_requested_at` |
| `np_public_profiles` | Vitrine publique | `slug` unique (regex, slugs réservés), `display_name`, `city`, `bio` ≤ 300, `instagram`, `published` |
| `np_opening_hours` | Plages hebdomadaires | `weekday` ISO 1-7, `start_min`/`end_min` ; GiST anti-chevauchement ; trigger : 3 plages max par jour |
| `np_closures` | Fermetures exceptionnelles | `[starts_at, ends_at)`, motif |
| `np_services` | Catalogue | `duration_min` (15-480, pas de 5), `price_cents` (null = sur devis), `allowed_locations`, `online`, `prep_min`, `refill_enabled`/`refill_days`, `position`, `archived` |
| `np_clients` | Fiches | V1 + `preferred_name`, `source` ; téléphone E.164 |
| `np_client_addresses` | Adresses d'intervention | une seule `is_primary` par cliente, `access_info` |
| `np_consents` | Journal des consentements | écrit **uniquement** par trigger sur `np_clients` ; `source` = `pro`/`online_form` ; lecture seule |
| `np_appointments` | RDV | instantanés `service_name`/`duration_min`/`price_cents`/`refill_*` ; `location_type` + adresse instantanée ; `buffer_before_min`/`buffer_after_min` ; `ends_at`, `block_start`, `block_end` **dérivés** ; `status` ; `source` ; `expires_at`/`expired` ; `anonymized_at` |
| `np_notifications` | Suggestions dans l'app | `kind` : `reminder`, `refill`, `confirmation`, `new_request`, `request_expired` ; `status` : `ready`/`dismissed`/`invalidated` |
| `np_booking_attempts` | Limitation de débit | clés hachées téléphone/IP, aucune exposition |
| `np_due_notifications` (vue) | Rappels/relances dus | `security_invoker` |

**Règles portées par la base.**
- `ends_at = starts_at + duration_min`. Le client envoie `starts_at` et `duration_min`, jamais `ends_at`.
- Tampons (R1) : chez la pro, `before = 0` et `after = service.prep_min` ; chez la cliente, `before = after = profile.travel_buffer_min`. Ces valeurs sont modifiables par RDV (0-120).
- Transitions (R6) : `done`/`no_show` ne passent plus en `cancelled`. Un RDV passé ne se déplace plus. `no_show` n'est possible qu'après l'heure de début. `pending` n'est possible qu'à la création en ligne. Une demande expirée ne peut pas être acceptée.
- Expiration (R5) : `expires_at = min(création + 24 h, début − délai minimum)`. Le balayage `np_expire_pending` passe au statut `cancelled` avec `expired = true` et notification `request_expired`. Il se déclenche avant tout contrôle de conflit, à chaque réservation publique et à chaque `np_refresh_notifications`.
- Une cliente archivée ne reçoit plus de RDV. Une cliente ayant un RDV à venir (`booked`/`pending`) ne peut être ni archivée ni supprimée.
- Suppression (F12) : `np_delete_client` anonymise les RDV passés (`client_id = null`, adresse effacée, `anonymized_at`) et supprime la fiche, les adresses, les consentements et les notifications.

### 4.1 Fonctions RPC

| Fonction | Rôle(s) | Type | Retour |
|---|---|---|---|
| `np_public_page(p_slug)` | anon, authenticated | DEFINER, stable | `jsonb` : `{slug, display_name, city, bio, instagram, trades, work_mode, zone_postal_codes, zone_radius_km, min_notice_min, max_horizon_days, slot_step_min, auto_confirm, services:[{id, trade, name, category, description, duration_min, price_cents, allowed_locations}]}` ou `null` |
| `np_available_slots(p_slug, p_service_id, p_location, p_from date, p_to date, p_postal_code?)` | anon, authenticated | DEFINER, stable | `table(slot_start timestamptz)` ; 31 jours max |
| `np_request_booking(p_slug, p_service_id, p_location, p_starts_at, p_first_name, p_last_name, p_phone, p_email?, p_message?, p_address_line?, p_postal_code?, p_city?, p_access_info?, p_reminder_opt_in?, p_refill_opt_in?, p_website?)` | anon, authenticated | DEFINER, volatile | `jsonb` : `{status, starts_at, ends_at, service_name, price_cents, location_type, city, expires_at}` |
| `np_slug_available(p_slug)` | authenticated | DEFINER | `boolean` |
| `np_expire_pending(p_owner?, p_except?)` | authenticated (restreint à soi), service_role | DEFINER | `integer` |
| `np_refresh_notifications()` | authenticated, service_role | INVOKER | `void` |
| `np_export_client(p_client_id)` | authenticated | INVOKER | `jsonb` |
| `np_delete_client(p_client_id)` | authenticated | INVOKER | `void` |
| `np_export_account()` | authenticated | INVOKER | `jsonb` |
| `np_request_account_deletion()` | authenticated | INVOKER | `void` (dépublie immédiatement ; effacement par un job service_role sous 30 j, Lot 1 manuel) |

`p_website` est le champ « pot de miel ». Rattachement à une fiche existante : téléphone normalisé **et** nom identique (casse et espaces ignorés), sinon nouvelle fiche (la pro décide). Limites : 5/h par téléphone, 5/h par IP (`cf-connecting-ip`, à défaut `x-forwarded-for`), 20 demandes/h et 15 demandes `pending` vivantes par pro, 3 `pending` par téléphone (voir `docs/AUDIT-SECURITE.md`). Codes d'erreur : `NP404` introuvable, `NP403` lieu ou zone refusés, `NP409` créneau pris, `NP422` saisie invalide, `NP429` trop de demandes, `23P01` chevauchement.

**Hors base au Lot 1** : la vérification du captcha Turnstile exige un secret serveur. Elle sera ajoutée par une Edge Function `book` qui vérifie le jeton puis appelle `np_request_booking` avec `service_role`, dès qu'un projet hébergé existera. Ce jour-là, on retirera `anon` de `np_request_booking` et on ajoutera `challenges.cloudflare.com` à la CSP. D'ici là, le pot de miel et les limites de débit SQL s'appliquent.

---

## 5. Contrat `src/domain.js` (propriété Backend, logique pure, sans I/O)

Les fonctions sont pures et testables avec `node --test`. Elles lèvent `Error` (message français) en cas de saisie invalide. Dates : chaînes ISO UTC en sortie ; `'AAAA-MM-JJ'` pour un jour local ; `'AAAA-MM-JJTHH:mm'` pour une heure locale de Paris.

### 5.1 Constantes

```js
export const TIME_ZONE = 'Europe/Paris';
export const TRADES = { nails: 'Ongles', hair: 'Coiffure', makeup: 'Maquillage' };
export const WORK_MODES = { home_studio: 'Chez moi', mobile: 'À domicile', both: 'Les deux' };
export const LOCATIONS = { pro: 'Chez moi', client: 'Chez la cliente' };
export const STATUSES = { pending: 'En attente', booked: 'Confirmé', done: 'Terminé', cancelled: 'Annulé', no_show: 'Absente' };
export const CLIENT_SOURCES = { manual: 'Saisie', instagram: 'Instagram', referral: 'Bouche-à-oreille', online: 'En ligne', other: 'Autre' };
export const SLOT_STEPS = [15, 30, 60];
export const RESERVED_SLUGS;      // identique à la liste SQL
export const DEFAULT_PROFILE;     // valeurs par défaut identiques aux DEFAULT SQL
export const DEFAULT_CATALOG;     // { nails: Service[], hair: Service[], makeup: Service[] } (F4)
export const DEFAULT_TEMPLATES;   // { confirmation, decline, reminder, refill }
export const HEALTH_WARNING = 'N’indiquez aucune information de santé (allergies, grossesse, traitements, pathologies).';
// SERVICES (liste fermée V1) est supprimé.
```

### 5.2 Temps et formatage (existant conservé, ajouts)

```js
escapeHtml(value) → string
parisLocal(iso?) → 'AAAA-MM-JJTHH:mm'
fromParisLocal(local) → iso             // rejette heures inexistantes ou ambiguës
formatDate(iso, options?) → string
formatPrice(cents | null) → '55,00 €' | 'Sur devis'
formatDuration(minutes) → '1 h 30'
minutesToTime(min) → 'HH:mm' ; timeToMinutes('HH:mm') → number
addDays('AAAA-MM-JJ', n) → 'AAAA-MM-JJ'
weekDays('AAAA-MM-JJ') → string[7]      // lundi → dimanche de la semaine du jour
isoWeekday('AAAA-MM-JJ') → 1..7
```

### 5.3 Validation (chaque fonction renvoie la charge utile exacte à persister)

```js
normalizePhone(phone) → '' | '+33…'
slugify(name) → string                   // suggestion valide ou '' ; validateSlug(slug) → slug
validateProfile(input) → { profile, publicProfile }
validateOpeningHours(rows) → rows        // ≤ 3 plages/jour, non chevauchantes, pas de 5 min
validateClosure(input) → { starts_at, ends_at, reason }   // accepte { day, allDay } ou { from, to } locaux
validateService(input) → Service
validateClient(input) → Client           // + preferred_name, source
validateAddress(input) → Address
validateAppointment(input, ctx) → AppointmentPayload
  // ctx = { appointments, clients, services, profile, now }
  // applique les instantanés (service → nom/durée/prix/refill) et les tampons R1, sauf surcharge explicite ;
  // lève 'Ce créneau chevauche…' selon la règle max (ADR-002) ; ne renvoie jamais ends_at/block_*
appointmentWarnings(input, ctx) → Array<'outside_hours' | 'closed' | 'outside_zone'>  // confirmation explicite côté UI
```

### 5.4 Règles de planification (miroir exact du SQL)

```js
computeBuffers({ location_type, service, profile }) → { before, after }
blockRange(appointment) → { starts_at, ends_at, block_start, block_end }
isBlocking(appointment, now?) → boolean  // booked/done/no_show, ou pending non expiré
conflicts(candidate, appointments, now?) → Appointment | null
isInZone(profile, postalCode) → boolean  // liste vide ⇒ true (rayon déclaratif)
availableSlots({ profile, openingHours, closures, appointments, service, location, from, to, now }) → iso[]
pendingExpiresAt(startsAt, profile, now?) → iso
allowedTransitions(appointment, now?) → status[]
```

### 5.5 Messages et liens (F9, F10, F11, F8)

```js
renderTemplate(template, vars) → string  // {prenom} {date} {heure} {prestation} {adresse} {lien}
buildMessage(kind, { appointment, client, profile, publicProfile, bookingUrl }) → string
  // kind ∈ confirmation | decline | reminder | refill ; lieu « chez moi, [ville] » ou « chez vous au [adresse] »
smsLink(phone, text) → 'sms:…' ; whatsappLink(phone, text) → 'https://wa.me/…' ; mapsLink(address) → url
icsEvent({ title, starts_at, ends_at, location }) → string   // contenu .ics
notificationCandidates(...) ; reconcileNotifications(...) ; refillDueAt(...)   // V1, étendus aux instantanés refill_*
toCsv(rows) → string
```

---

## 6. Contrat `src/store.js` (propriété Backend)

Deux implémentations derrière la même API : **Supabase** quand les trois variables sont présentes, **démo localStorage** sinon (clé `nailpilot-demo-v2`, jeu de démo comprenant le profil publié `studio-demo`). Le garde-fou des project refs interdits reste **inchangé**. Toutes les méthodes sont `async`, sauf les getters. Après chaque écriture, le store recharge l'état et notifie les abonnés.

### 6.1 Espace pro — `createStore()`

```js
const store = createStore();
store.mode            // 'demo' | 'supabase'
store.user            // { id, email } | null (démo : utilisateur fictif)
store.state           // { profile, publicProfile, openingHours, closures, services, clients, addresses,
                      //   appointments, notifications, consents }  — lecture seule pour le Frontend
store.needsOnboarding // boolean (profile absent ou onboarded_at null)
store.pendingCount    // nombre de demandes pending non expirées
store.subscribe(fn) → unsubscribe

// F1 — authentification
load()
signUp(email, password)               // ≥ 8 caractères ; résout { needsEmailConfirmation: true }
login(email, password)                // erreur générique « Identifiants incorrects. »
logout()
requestPasswordReset(email)           // résout toujours (ne révèle pas l'existence du compte)
updatePassword(password)              // après lien de réinitialisation

// F2 — profil
saveProfile(input)                    // profil privé + vitrine ; positionne onboarded_at à la fin de l'assistant
isSlugAvailable(slug) → boolean
setPublished(published)

// F3 — horaires
saveOpeningHours(rows)                // remplace l'ensemble de la semaine
saveClosure(input, id?) ; deleteClosure(id)

// F4 — catalogue
seedCatalog(trades)                   // insère DEFAULT_CATALOG des métiers choisis, idempotent
saveService(input, id?) ; archiveService(id, archived = true) ; deleteService(id)
reorderServices(ids)                  // ordre complet

// F7 — clientes
saveClient(input, id?) → client
archiveClient(id)
saveAddress(clientId, input, id?) ; deleteAddress(id)
exportClient(id) → { client, addresses, appointments, consents }   // le Frontend produit JSON/CSV
deleteClient(id)                      // définitif, anonymise l'historique

// F5, F6, F9 — rendez-vous
saveAppointment(input) → appointment
  // input = { id?, client_id, service_id, location_type, address_id? | address fields,
  //           starts_at, duration_min?, buffer_before_min?, buffer_after_min?, status?, cancel_reason? }
setStatus(id, status, reason?)        // booked | done | cancelled | no_show
acceptRequest(id) ; declineRequest(id, reason?)

// F10, F11 — messages
refreshNotifications() ; dismissNotification(id)

// F12 — compte
exportAccount() → object
requestAccountDeletion()
```

### 6.2 Page publique — `createPublicApi()` (sans session, chargée par la vue publique)

```js
const api = createPublicApi();
api.getPage(slug) → PublicPage | null
api.getSlots({ slug, serviceId, location, from, to, postalCode? }) → iso[]   // from/to : 'AAAA-MM-JJ', 31 j max
api.requestBooking({ slug, serviceId, location, startsAt, firstName, lastName, phone, email?, message?,
                     address?: { line, postalCode, city, accessInfo }, reminderOptIn, refillOptIn, website })
  → { status: 'pending' | 'booked', starts_at, ends_at, service_name, price_cents, location_type, city, expires_at }
```

En démo, `createPublicApi()` lit le même localStorage et applique `domain.availableSlots`. Une réservation de démo apparaît donc dans l'agenda de démo, ce qui permet de tester le parcours en e2e sans Supabase.

### 6.3 Erreurs

`throw Object.assign(new Error(messageFr), { code })`, avec `code` ∈ `validation`, `not_found`, `forbidden_location`, `slot_taken`, `overlap`, `rate_limited`, `auth`, `network`. Correspondance SQL : `NP422`→`validation`, `NP404`→`not_found`, `NP403`→`forbidden_location`, `NP409`→`slot_taken`, `23P01`→`overlap`, `NP429`→`rate_limited`. Le Frontend affiche `error.message` et ne branche sa logique que sur `error.code` (par exemple, `slot_taken` déclenche le rechargement des créneaux).

---

## 7. Répartition des fichiers et règles de travail en parallèle

| Propriétaire | Fichiers |
|---|---|
| **Backend** | `supabase/*`, `src/domain.js`, `src/store.js`, `tests/domain.test.js`, `tests/database.test.js` |
| **Frontend** | `src/app.js`, `src/router.js`, `src/views/*`, `src/components/*`, `src/style.css`, `index.html`, `vercel.json` (réécriture `/r/:slug`, CSP), `tests/e2e/*`, `playwright.config.js` |
| **Architecte** (sur demande) | `docs/ARCHITECTURE.md` : toute modification du contrat passe par ici |

1. **Jour 0 (Backend, en premier)** : publier `domain.js` et `store.js` avec **toutes** les signatures ci-dessus. Les fonctions non terminées lèvent `new Error('Non implémenté')`. Le mode démo de `load()` fournit un jeu complet (profil, horaires, 3 prestations, 3 clientes, RDV dont un `pending` et un chez la cliente). Le Frontend démarre sur cette base.
2. Le Frontend n'importe que les symboles listés ici. Pour un besoin nouveau, il ouvre une demande sur ce document plutôt que d'écrire dans `domain.js`/`store.js`.
3. Le Backend ne modifie aucun fichier d'interface. S'il casse une signature, il met à jour ce document dans le même commit.
4. Pendant la refonte, `src/app.js` V1 utilise `SERVICES` et l'ancien `validateAppointment`. Le Backend conserve ces exports, marqués `@deprecated`, jusqu'à ce que le Frontend signale le retrait. Les e2e V1 doivent rester verts à chaque commit.
5. Définition de « terminé » commune : `npm test`, `npm run build` et `npm run test:e2e` verts. Toute règle SQL de planification a son test miroir dans `tests/domain.test.js`.

---

## 8. Points ouverts

- Captcha Turnstile et Edge Function `book` : dès qu'un projet Supabase dédié existera (§4.1).
- Job de purge des comptes (`deletion_requested_at` + 30 j) : script `service_role`, Lot 1 manuel.
- `zone_radius_km` reste déclaratif (aucun géocodage avant le Lot 2, F15).
- Pagination au-delà de 1 000 lignes : à reprendre de la V1 dans `store.js`.
- OG tags par pro : impossibles en SPA statique ; aperçu générique au Lot 1.
