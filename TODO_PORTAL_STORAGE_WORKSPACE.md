# TODO - Portal Storage Workspace Refactor

## Objectif

Transformer `/portal` en portail utilisateur simplifie, distinct de `/browser`,
`/manager` et `/admin`.

Le portail cible est centre sur :

- espaces de stockage abstraits (`Storage Spaces`) ;
- partage et collaboration ;
- activite recente ;
- transferts ;
- consommation, quota et alertes simples ;
- preferences utilisateur simples.

Regles non negociables :

- ne pas exposer IAM, policy JSON, principal, ARN, ACL avancees ou diagnostics S3 dans `/portal` ;
- ne pas dupliquer `/browser` ;
- garder IAM/S3 comme source de verite des permissions ;
- utiliser `Storage Space` cote UI, meme si v1 mappe un Storage Space vers un bucket S3 reel ;
- garder les fonctions avancees dans `/browser`, `/manager` ou `/admin`.

## Principes D'implementation Pour Codex

- Traiter les etapes dans l'ordre, sauf correction bloquante decouverte pendant l'analyse.
- Avant toute modification non triviale, relire `doc/docs/developer/ai-assistant-guidelines.md`.
- Preferer une premiere iteration UX visible et navigable, puis remplacer les mocks par de vraies donnees.
- Garder les changements scopes a `/portal` quand c'est possible.
- Ne jamais introduire de modele de permission parallele : les roles UI simples doivent toujours etre traduits vers IAM/S3 cote backend.
- Documenter explicitement toute compatibilite temporaire, notamment les redirections depuis les anciennes routes.

## Etape 1 - Refacto UX Complete Mock-first

Objectif : obtenir rapidement l'UX cible visible et navigable, en reutilisant les
donnees existantes quand elles existent et en mockant le reste.

- [x] Remplacer la navigation `/portal` par :
  - Home
  - Storage Spaces
  - Shares
  - Activity
  - Transfers
  - Usage & Analytics
  - Settings
- [x] Retirer `/portal/browser` de la navigation utilisateur.
- [x] Renommer visuellement `Buckets` en `Storage Spaces` dans `/portal`.
- [x] Ajouter une redirection temporaire `/portal/buckets` -> `/portal/storage-spaces`.
- [x] Remplacer `/portal/manage` par `/portal/shares` cote UX.
- [x] Remplacer `/portal/billing` par `/portal/usage` ou `/portal/usage-analytics`.
- [x] Construire la Home avec :
  - espace utilise / quota ;
  - usage par Storage Space ;
  - activite recente ;
  - espaces partages avec moi ;
  - transferts recents ;
  - alertes simples.
- [x] Reutiliser les donnees existantes :
  - `PortalState.buckets` pour les Storage Spaces ;
  - `PortalUsage` pour quota/usage ;
  - `fetchPortalTraffic` pour tendances ;
  - endpoint health/incidents pour alertes de disponibilite.
- [x] Mocker temporairement :
  - activite recente si audit filtre portail indisponible ;
  - transferts recents ;
  - liens expirants ;
  - espaces partages avec moi / par moi quand l'API manque ;
  - alertes public bucket si l'etat public n'est pas encore expose.
- [x] Creer l'ecran `Storage Spaces` :
  - liste simple des espaces ;
  - recherche ;
  - usage ;
  - nombre d'objets ;
  - role utilisateur simple ;
  - statut simple ;
  - action principale "Open".
- [x] Creer un detail `Storage Space` simple :
  - onglet Overview ;
  - onglet Files avec navigation objet simplifiee ;
  - onglet Shares ;
  - onglet Activity ;
  - aucun lien "Open in Browser".
- [x] Creer l'ecran `Shares` :
  - `Shared with me` ;
  - `Shared by me` ;
  - `Public links` mocke si necessaire ;
  - roles visibles `Viewer`, `Editor`, `Owner`.
- [x] Creer l'ecran `Activity` :
  - timeline filtrable ;
  - evenements mockes ou audit existant ;
  - libelles orientes utilisateur.
- [x] Creer l'ecran `Transfers` :
  - uploads/downloads recents ;
  - statut, progression, taille, date ;
  - donnees mockees en v1 UX.
- [x] Creer l'ecran `Usage & Analytics` :
  - usage total ;
  - usage par Storage Space ;
  - trafic in/out ;
  - requetes ;
  - tendances simples.
- [x] Simplifier `Settings` :
  - preferences utilisateur simples uniquement ;
  - retirer ou masquer IAM policies, bucket defaults, CORS, lifecycle, versioning.
- [x] Ajouter des tests frontend de navigation et rendu minimal.
- [x] Critere d'acceptation : un utilisateur arrive sur un dashboard, pas dans un bucket ni dans le browser avance.

## Etape 1b - Alignement Maquette Portal V3

Objectif : faire ressembler la version mock-first a la maquette fournie, avec un
theme limite a `/portal`.

- [x] Creer la branche locale `portal_v3` avec les changements locaux conserves.
- [x] Remplacer le shell `/portal` par un layout dedie avec sidebar type maquette.
- [x] Ajouter la section `Administration` mock/read-only :
  - Users ;
  - Groups ;
  - Policies ;
  - Access Keys ;
  - Settings.
- [x] Ajouter un theme scoped `/portal` :
  - fond gris clair ;
  - cartes blanches ;
  - bordures fines ;
  - ombres legeres ;
  - rayons 8px ;
  - typographie dense.
- [x] Refaire les ecrans mockes pour se rapprocher de la maquette :
  - Dashboard ;
  - Storage Spaces ;
  - Storage Space Detail ;
  - Shares ;
  - Activity ;
  - Transfers ;
  - Usage & Analytics ;
  - Settings.
- [x] Enrichir les mocks locaux avec :
  - objets ;
  - utilisateurs ;
  - groupes ;
  - policies simples ;
  - access keys masquees ;
  - series chart ;
  - regions ;
  - statuts et badges.
- [x] Ajouter/mettre a jour les tests frontend de rendu minimal.
- [ ] Verification visuelle navigateur et screenshots.

## Etape 2 - Abstraction Storage Space

Objectif : remplacer progressivement le modele mental bucket par Storage Space.

- [x] Ajouter les types frontend `PortalStorageSpace`, `PortalStorageSpaceSummary`, `PortalStorageSpaceRole`.
- [x] Ajouter les modeles backend equivalents.
- [x] Ajouter `GET /portal/storage-spaces`.
- [x] Ajouter `GET /portal/storage-spaces/{space_id}`.
- [x] Mapper v1 `space_id` vers le nom du bucket reel.
- [x] Garder le nom du bucket comme detail interne, jamais comme libelle principal UI.
- [x] Faire migrer l'UI de `PortalState.buckets` vers ces nouveaux endpoints.
- [x] Ne pas retenir la compatibilite temporaire `/portal/buckets` comme objectif produit.
- [x] Ajouter tests backend sur isolation compte et roles portail.

## Etape 3 - Navigation Objet Portail Simplifiee

Objectif : permettre browse/upload/download dans `/portal` sans dependre de
`/browser` ni `/manager`.

- [x] Ajouter `GET /portal/storage-spaces/{space_id}/objects`.
- [x] Ajouter upload simple.
- [x] Ajouter download simple.
- [x] Utiliser les credentials portail/IAM existants.
- [x] Auditer upload/download avec scope `portal`.
- [x] Ne pas exposer :
  - versions ;
  - delete markers ;
  - tags ;
  - metadata headers ;
  - multipart ;
  - object lock ;
  - batch operations ;
  - diagnostics S3.
- [x] Remplacer l'usage frontend de `/manager/buckets/.../objects`.
- [x] Ajouter tests permissions Viewer/Editor.

## Etape 4 - Shares Et Roles Simples

Objectif : exprimer les permissions en termes utilisateur.

- [ ] Definir les roles UI :
  - Viewer : lire/lister/telecharger ;
  - Editor : Viewer + upload/modification simple ;
  - Owner : gestion de l'espace et du partage.
- [ ] Traduire ces roles en policies IAM cote backend.
- [ ] Ajouter `GET /portal/storage-spaces/{space_id}/shares`.
- [ ] Ajouter grant/revoke/update share.
- [ ] Remplacer les libelles `portal_user`, `portal_manager`, `bucket permissions` par `Viewer`, `Editor`, `Owner`, `Shared with me`, `Shared by me`.
- [ ] Garder IAM comme source de verite ; ne pas creer de permission parallele.
- [ ] Ajouter tests de mapping IAM.

## Etape 5 - Activity, Transfers, Alerts

Objectif : remplacer les mocks UX par des donnees reelles.

- [ ] Ajouter endpoint activite portail filtre par compte et storage space.
- [ ] Alimenter Activity depuis audit logs et operations portail.
- [ ] Ajouter suivi frontend des transferts recents.
- [ ] Ajouter persistance backend des transferts si necessaire.
- [ ] Ajouter endpoint alertes simples :
  - quota proche ;
  - storage space public ;
  - lien expirant ;
  - erreur de transfert ;
  - endpoint degrade.
- [ ] Connecter Home aux vraies donnees.
- [ ] Ajouter tests backend et frontend.

## Etape 6 - Usage & Analytics

Objectif : consolider usage, trafic et facturation dans une vue utilisateur.

- [ ] Reutiliser `PortalUsage`, `fetchPortalTraffic` et billing si active.
- [ ] Ajouter usage par Storage Space.
- [ ] Ajouter tendances temporelles.
- [ ] Masquer les metriques indisponibles proprement.
- [ ] Renommer l'ancien ecran Billing en sous-section ou source de donnees.
- [ ] Ajouter tests d'etats sans metriques, sans billing, et quota absent.

## Etape 7 - Nettoyage Separation Des Surfaces

Objectif : finaliser la separation `/portal`, `/browser`, `/manager`, `/admin`.

- [ ] Supprimer ou deprecier `/portal/browser`.
- [ ] Retirer `BrowserEmbed` du portail.
- [ ] Deplacer reglages IAM avances vers `/manager` ou `/admin`.
- [ ] Garder `/portal/settings` limite aux preferences simples.
- [ ] Documenter la separation des surfaces.
- [ ] Mettre a jour les tests route/access.
- [ ] Verifier qu'aucun texte portail utilisateur ne mentionne IAM, policy JSON, ARN ou ACL avancees.

## Validation Globale

- [ ] `npm run test` frontend cible.
- [ ] Tests backend portail.
- [ ] Tests de non-regression permissions IAM.
- [ ] Verification manuelle responsive desktop/mobile.
- [ ] Verification qu'un utilisateur final peut :
  - voir son dashboard ;
  - ouvrir un Storage Space ;
  - parcourir simplement ;
  - uploader/download ;
  - partager ;
  - voir activite, transferts et usage ;
  - regler ses preferences simples.

## Assumptions

- Nom du fichier retenu : `TODO_PORTAL_STORAGE_WORKSPACE.md`.
- Langue du fichier : francais, car la demande et la conception produit sont en francais.
- Premiere livraison volontairement UX-first : les mocks sont acceptes uniquement pour rendre l'experience visible avant les refactors backend.
