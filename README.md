# NailPilot V1

MVP pour prothésistes ongulaires indépendantes. GitHub + Supabase + Vercel uniquement. Aucun module financier.

## État

Version de prévisualisation, avec démonstration locale si Supabase n’est pas configuré. Les exemples sont fictifs et les données de démonstration sont stockées dans le navigateur. Ne pas y saisir de données réelles.

La base hébergée dédiée n’est pas encore créée. L’authentification et le parcours Supabase hébergé ne sont donc pas encore validés. Les tests SQL utilisent le véritable schéma dans PostgreSQL/WASM isolé, sans toucher à une base existante.

## Modules

- Agenda par jour : création, modification, durée, prestations, statuts confirmé/terminé/annulé. Contrôle des chevauchements dans l’interface et contrainte GiST en base. Heure de Paris, y compris changements d’heure.
- Fiches clientes : recherche, coordonnées, préférences, délai de remplissage de 7 à 90 jours, accords distincts pour rappels et relances, historique, archivage conservant l’historique.
- Rappels : suggestions disponibles 24 heures avant un rendez-vous. Copie du texte et suivi du traitement manuel. Invalidation des rappels annulés, périmés ou privés de consentement.
- Remplissages : suggestions après la dernière prestation terminée et le délai de la cliente. Suppression lorsqu’un rendez-vous est déjà prévu. Prise en compte des retraits d’accord et archivages.

**Aucun SMS ni e-mail envoyé.** Les règles et messages sont préparés automatiquement, mais leur livraison externe n’est pas implémentée. Il faudra autoriser un prestataire de messagerie pour envoyer des SMS : ce prestataire sort du périmètre actuel et peut entraîner des frais. Le Cron SQL optionnel prépare seulement des suggestions dans l’application, sans appeler de service externe.

## Développement

Node.js 24 recommandé.

```sh
npm ci --ignore-scripts
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` exécute les règles métier et le schéma PostgreSQL isolé. `npm run test:e2e` teste les parcours réels dans Chromium pour les formats bureau et téléphone, avec des données synthétiques. Cela ne vaut pas validation du service Supabase hébergé ni Safari/iOS natif.

## Connexion future à Supabase

1. Confirmer l’organisation et l’absence de frais avant de créer un **nouveau projet dédié de prévisualisation**. Ne réutiliser aucune base EauConnect, Artisans ou Ménage.
2. Appliquer `supabase/schema.sql` uniquement sur ce nouveau projet. Le script crée les tables `np_clients`, `np_appointments`, `np_notifications`, les politiques RLS et la fonction de calcul.
3. Vérifier les conseillers Supabase et les autorisations avec deux comptes de test indépendants et un accès anonyme.
4. Créer les comptes par invitation dans Supabase Auth ; pas de création libre de compte dans cette version.
5. Définir, pour la branche de prévisualisation uniquement, les trois variables de `.env.example` dans Vercel. La clé doit être publique/publishable, jamais `service_role`. Le code bloque explicitement les trois projets existants connus.
6. Recompiler, tester connexion, écriture et lecture réelles, puis valider l’isolation entre comptes via PostgREST.
7. Après validation, le script optionnel `supabase/enable-preview-scheduler.sql` peut préparer les suggestions toutes les cinq minutes. Sans ce Cron, elles sont actualisées au chargement et chaque minute lorsque l’application est ouverte.

Le bootstrap est volontairement nommé `schema.sql` : aucune migration n’a été enregistrée ou appliquée à distance. Lors de la création de l’historique, utiliser `supabase migration new`, puis capturer ce schéma avec les outils Supabase.

## Prévisualisation Vercel

Projet : `nailpilot-v1-preview`. Branche de travail : `codex/nailpilot-mvp`. `main` reste au commit initial et ses déploiements automatiques sont désactivés dans `vercel.json`. Déployer explicitement avec la cible `preview`, jamais `production`. Pas de Vercel Cron, fonction payante, domaine ou base externe provisionné.

La CI GitHub vérifie les tests, le build et les parcours Chromium sur les branches `codex/**` et les PR vers `main`. Elle ne déploie pas et n’applique aucun SQL. Les dépendances sont épinglées et le lockfile est versionné.

## Limites avant commercialisation

- Activer et tester la base Supabase dédiée, Auth, RLS et la synchronisation réelle.
- Brancher et tester un prestataire pour les envois réels, avec consentement, désabonnement, journal d’envoi, retries et déduplication côté prestataire.
- Les notifications sont des suggestions à traiter ; « traité » ne signifie jamais « envoyé » ou « reçu ».
- Pagination à ajouter avant de dépasser 1 000 clientes ou rendez-vous par compte. Le chargement refuse les données tronquées.
- Pas encore de réservation publique Instagram, de synchronisation Google Agenda, de vues semaine/mois, de photos, de réinitialisation autonome du mot de passe ou de PWA hors ligne.
- Pour de vraies clientes : compléter information de confidentialité, politique de conservation et suppression/export des données. Ne pas stocker de données de santé dans les notes.
