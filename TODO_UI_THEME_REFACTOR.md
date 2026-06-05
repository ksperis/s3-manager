# TODO - Refacto Theme UI Entreprise

## Objectif

Uniformiser le theme de l'interface autour du shell recent
topbar/sidebar, puis faire converger le reste de l'UI vers une console
entreprise moderne, sobre et dense.

Le rendu cible doit rester compatible avec deux usages :

- portail utilisateur simple et rassurant pour `/portal` ;
- portail operationnel lisible pour `/admin`, `/manager`, `/browser`,
  `/ceph-admin` et `/storage-ops`.

Influences souhaitees : Home Assistant pour la clarte des surfaces et des
etats, NetBox pour la densite operationnelle et la lisibilite des inventaires.

## Regles Non Negociables

- Ne pas modifier les routes, les API backend, les permissions, les workflows
  IAM/S3, les contrats d'execution ou les modeles metier.
- Garder la topbar et la sidebar actuelles comme reference visuelle.
- Adapter le contenu au shell, pas l'inverse.
- Reduire les gradients, transparences, `backdrop-blur`, ombres fortes et
  rayons excessifs.
- Ne pas introduire de theme parallele par workspace.
- Ne pas transformer le portail utilisateur en console S3 avancee.
- Ne pas melanger S3 Account, S3 Connection, legacy S3 user et contexte
  Ceph Admin.

## Principes Codex

- Avant chaque etape non triviale, relire
  `doc/docs/developer/ai-assistant-guidelines.md`.
- Traiter les etapes dans l'ordre, sauf correction bloquante decouverte
  pendant l'analyse.
- Faire des lots courts, chacun valide par typecheck et tests cibles.
- Proteger le rendu light et dark a chaque lot.
- Laisser les changements utilisateur non lies intacts dans l'arbre git.
- Ne pas refactorer les flux metier pendant le refacto visuel.
- Factoriser uniquement quand cela reduit une duplication reelle ou stabilise
  un motif UI recurrent.
- Preferer les primitives partagees existantes avant d'en creer de nouvelles.

## Cible Visuelle

- Page : fond sobre `shell-page`, faible contraste, aucune decoration
  marketing.
- Surfaces : cartes et panneaux opaques ou quasi opaques, bordures nettes,
  ombre faible ou absente.
- Rayons : 8px pour les cartes/panneaux/menus standards ; garder les pills et
  badges en `rounded-full` quand c'est un vrai badge.
- Typographie : dense, lisible, sans tailles hero dans les panneaux.
- Etats : hover/selected/focus proches du shell, avec accent primaire mesure.
- Couleurs : conserver le primaire existant ; limiter les familles de bleus
  sombres, gradients et variations translucides.
- Tables : lecture prioritaire, densite operationnelle, entetes stables,
  lignes clairement separees, actions compactes.
- Modales/drawers : surfaces pleines, overlay simple, ombre maitrisee,
  fermeture et focus accessibles.

## Etape 1 - Audit Et Tokens

Objectif : disposer d'une base theme unique avant de migrer les composants.

- [x] Inventorier les patterns visuels a reduire :
  - `bg-gradient`, `from-*`, `via-*`, `to-*` ;
  - `backdrop-blur`, `blur-*` ;
  - `bg-white/*`, `bg-slate-*/*`, `dark:bg-*/*` sur surfaces principales ;
  - `rounded-xl`, `rounded-2xl`, `rounded-3xl` hors badges/pills ;
  - `shadow-lg`, `shadow-xl`, `shadow-2xl` hors menus/overlays justifies.
- [x] Utiliser une commande d'audit reproductible, par exemple :

```bash
rtk rg -n "bg-gradient|from-|via-|to-|backdrop|bg-white/|dark:bg-[^ ]*/|rounded-(xl|2xl|3xl)|shadow-(lg|xl|2xl)|blur-" frontend/src --glob '!**/*.test.*'
```

- [x] Consolider `frontend/src/index.css` :
  - garder `--shell-*` comme reference du shell ;
  - faire converger `--ui-*` vers les memes familles de couleurs ;
  - ajouter si necessaire `--ui-border-soft`, `--ui-hover`,
    `--ui-selected-bg`, `--ui-focus-ring`, `--ui-shadow-soft`.
- [x] Modifier `.ui-surface-card` et `.ui-surface-muted` pour utiliser :
  - surfaces opaques ;
  - `rounded-lg` par defaut ;
  - `border` explicite ;
  - ombre faible ou aucune ombre en dark mode.
- [x] Modifier `.ui-control`, `.ui-button-*`, `.ui-data-table` pour rapprocher
  leurs couleurs, focus et hover du shell.
- [x] Verifier que la topbar/sidebar ne changent pas visuellement, sauf si un
  token global devait corriger une incoherence evidente.

Critere d'acceptation :

- [x] Le shell reste stable.
- [x] Les primitives CSS de base produisent des surfaces moins transparentes.
- [x] Les cartes/panneaux standards passent a 8px.
- [x] Aucun flux ou contenu metier n'est modifie.

Validation minimale :

```bash
npm --prefix frontend run typecheck
```

Validation realisee le 2026-06-05 :

```bash
rtk rg -n "bg-gradient|from-|via-|to-|backdrop|bg-white/|dark:bg-[^ ]*/|rounded-(xl|2xl|3xl)|shadow-(lg|xl|2xl)|blur-" frontend/src --glob '!**/*.test.*'
rtk npm --prefix frontend run typecheck
rtk npm --prefix frontend run build
rtk npm exec -- playwright test -c playwright.docs.config.ts portalVisualQa.spec.ts
```

La commande Playwright ci-dessus a ete executee depuis `frontend/`.

## Etape 2 - Primitives UI Partagees

Objectif : reduire les chaines Tailwind locales et rendre les migrations de
pages mecaniques.

- [x] Mettre a jour `frontend/src/components/ui/styles.ts` avec des classes
  partagees pour :
  - cartes et panneaux ;
  - panneaux muteds ;
  - champs et labels ;
  - boutons et boutons icones ;
  - badges et banners ;
  - menus et popovers ;
  - tables, entetes, cellules et lignes ;
  - toolbars et zones de filtres.
- [x] Mettre a jour les primitives existantes :
  - `UiCard` ;
  - `UiButton` ;
  - `Modal` ;
  - `PageHeader` ;
  - `PageControlStrip` ;
  - `ListSectionCard` ;
  - `ListToolbar`.
- [x] Evaluer la creation de nouvelles primitives ; non retenu pour cette
  etape car les classes partagees suffisent :
  - `UiDataTable` pour remplacer les tables ad hoc recurrentes ;
  - `UiFormField` pour les labels/aides/erreurs repetes ;
  - `UiActionMenu` pour les menus d'action de lignes ;
  - `UiPanel` pour les panneaux non-cartes ;
  - `UiMetricTile` pour les tuiles de dashboard.
- [x] Garder les APIs de composants simples :
  - pas de schema metier dans les composants UI ;
  - pas de dependance a un workspace specifique ;
  - props de variante limitees a `primary`, `secondary`, `ghost`,
    `warning`, `danger`, `neutral`.
- [x] Remplacer les boutons/actions ad hoc dans les composants partages par
  `UiButton` ou une classe partagee.

Critere d'acceptation :

- [x] Les primitives partagees rendent le meme contenu avec moins de classes
  locales.
- [x] Les tests existants de composants restent valides.
- [x] Les modales et toolbars restent accessibles au clavier.

Validation minimale :

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test -- src/components/__tests__/Modal.test.tsx src/components/__tests__/PageHeader.test.tsx src/components/__tests__/TopbarDropdownSelect.test.tsx
```

Validation realisee le 2026-06-05 :

```bash
rtk npm --prefix frontend run typecheck
rtk npm --prefix frontend run test -- src/components/__tests__/Modal.test.tsx src/components/__tests__/PageHeader.test.tsx src/components/__tests__/TopbarDropdownSelect.test.tsx
rtk npm --prefix frontend run build
rtk npm --prefix frontend run test -- src/components/__tests__/ListToolbar.test.tsx
```

## Etape 3 - Shell-Adjacent Controls

Objectif : aligner les controles proches du shell et eviter des surfaces
concurrentes dans la topbar.

- [x] Aligner les selecteurs statiques sur `shell-control` :
  - `PortalLayout` pour le compte portal statique ;
  - `CephAdminLayout` pour l'endpoint statique ;
  - autres selecteurs topbar statiques decouverts pendant l'audit.
- [x] Harmoniser les menus/dropdowns avec :
  - `shell-menu` ;
  - `shell-menu-muted` ;
  - `shell-menu-item` ;
  - `shell-menu-item-active`.
- [x] Reduire dans les modales et drawers :
  - `backdrop-blur-sm` ;
  - `shadow-2xl` ;
  - `rounded-2xl`.
- [x] Garder les overlays lisibles en dark mode avec une opacite simple et
  stable, sans effet decoratif.
- [x] Verifier que les controles topbar adaptatifs gardent les modes
  `icon` et `icon_label`.

Critere d'acceptation :

- [x] Les controles topbar statiques et interactifs se ressemblent.
- [x] Les menus et modales utilisent le meme langage de surface que le shell.
- [x] Aucun selecteur ne perd son titre, son `aria-label` ou son comportement
  clavier.

Validation minimale :

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test -- src/components/__tests__/Topbar.test.tsx src/components/__tests__/TopbarDropdownSelect.test.tsx src/components/__tests__/Layout.test.tsx
```

Validation realisee le 2026-06-05 :

```bash
rtk npm --prefix frontend run typecheck
rtk npm --prefix frontend run test -- src/components/__tests__/Topbar.test.tsx src/components/__tests__/TopbarDropdownSelect.test.tsx src/components/__tests__/Layout.test.tsx
rtk npm --prefix frontend run build
```

## Etape 4 - Migration Par Workspaces

Objectif : migrer les pages par zones, apres stabilisation des tokens et
primitives.

### Lot A - Dashboards Et Metriques

- [x] Migrer les surfaces et tuiles de :
  - `frontend/src/features/admin/AdminDashboard.tsx` ;
  - `frontend/src/features/manager/UsageOverview.tsx` ;
  - `frontend/src/components/StorageUsageCard.tsx` ;
  - `frontend/src/components/MetricsTrafficOverview.tsx` ;
  - `frontend/src/components/StatCards.tsx` ;
  - `frontend/src/components/WorkspaceEndpointHealthCards.tsx`.
- [x] Remplacer les cartes arrondies/translucides par les primitives cible.
- [x] Garder les graphiques lisibles en light/dark sans gradients decoratifs.
- [x] Factoriser les tuiles de metriques repetitives via `UiMetricTile` si cela
  reduit vraiment la duplication.
  - Decision 2026-06-05 : ne pas ajouter `UiMetricTile` pour l'instant ;
    `UsageTile`, `StatCards` et les primitives `ui-surface-*` couvrent le lot
    sans abstraction supplementaire utile.

Validation lot A :

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test -- src/components src/features/storageOps/StorageOpsDashboard.test.tsx
```

Validation realisee le 2026-06-05 :

```bash
rtk npm --prefix frontend run typecheck
rtk npm --prefix frontend run test -- src/components src/features/storageOps/StorageOpsDashboard.test.tsx
```

### Lot B - Listes, Tables Et Actions

- [x] Migrer les listes Admin, Manager, Ceph Admin et Storage Ops vers les
  classes/primitives partagees :
  - headers de listes ;
  - toolbars ;
  - filtres ;
  - tables ;
  - menus d'actions ;
  - pagination.
- [x] Cibler d'abord les pages deja proches de `ui-surface-card`.
- [x] Eviter de rearchitecturer les composants metier pendant cette migration.
- [x] Conserver la densite operationnelle : colonnes stables, actions compactes,
  pas de cardification des tableaux.

Validation lot B :

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test -- src/components/__tests__/ListToolbar.test.tsx src/components/__tests__/ColumnVisibilityPicker.test.tsx
```

Validation realisee le 2026-06-05 :

```bash
rtk npm --prefix frontend run typecheck
rtk npm --prefix frontend run test -- src/components/__tests__/ListToolbar.test.tsx src/components/__tests__/ColumnVisibilityPicker.test.tsx
```

### Lot C - Pages Complexes

- [x] Migrer uniquement apres les lots A et B :
  - `frontend/src/features/browser/BrowserPage.tsx` ;
  - `frontend/src/features/manager/BucketDetailPage.tsx` ;
  - `frontend/src/features/shared/BucketOpsWorkbench.tsx`.
- [x] Proceder par sous-sections visibles, pas par gros rewrite.
- [x] Remplacer les constantes de classes ad hoc par des primitives partagees
  lorsque cela ne change pas le comportement.
- [x] Preserver les workflows critiques : operations browser, lifecycle,
  notification, replication, compare/remediation, batch actions.

Validation lot C :

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint:browser
npm --prefix frontend run test -- src/features/browser src/features/manager/__tests__
```

Validation realisee le 2026-06-05 :

```bash
rtk npm --prefix frontend run typecheck
rtk npm --prefix frontend run lint:browser
rtk npm --prefix frontend run test -- src/features/browser src/features/manager/__tests__
rtk npm --prefix frontend run test -- src/features/shared/BucketOpsWorkbench.statsFallback.test.tsx src/features/shared/BucketOpsWorkbench.columns.test.tsx src/features/shared/BucketOpsWorkbench.selectionActions.test.tsx src/features/shared/BucketOpsWorkbench.advancedFilter.test.ts
```

### Lot D - Portal

- [x] Verifier s'il reste un theme scoped `/portal`.
- [x] Supprimer le theme scoped restant seulement si les primitives communes
  couvrent le besoin.
- [x] Garder le vocabulaire portail utilisateur :
  - Storage Spaces ;
  - Shares ;
  - Activity ;
  - Transfers ;
  - Usage & Analytics.
- [x] Ne pas reintroduire IAM, policies JSON, ARNs ou diagnostics S3 avances
  dans `/portal`.
- [x] Garder `/portal` distinct de `/browser`, `/manager` et `/admin`.

Validation lot D :

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test:portal
npm --prefix frontend run docs:screenshots
npm --prefix frontend run docs:screenshots:check
```

Validation realisee le 2026-06-05 :

```bash
rtk npm --prefix frontend run typecheck
rtk npm --prefix frontend run test:portal
rtk npm --prefix frontend run docs:screenshots
rtk npm --prefix frontend run docs:screenshots:check
rtk npm --prefix frontend run build
```

## Etape 5 - QA Visuelle Transverse

Objectif : verrouiller la coherence du theme sur toutes les surfaces.

- [x] Ajouter ou etendre une QA Playwright legere sur routes representatives :
  - `/admin` ;
  - `/manager` ;
  - `/browser` ;
  - `/ceph-admin` ;
  - `/storage-ops` ;
  - `/portal`.
- [x] Couvrir light et dark.
- [x] Couvrir desktop et mobile.
- [x] Verifier :
  - pas d'overflow horizontal ;
  - main content visible ;
  - topbar/sidebar visibles et non chevauchantes ;
  - focus clavier possible ;
  - absence de texte coupe dans les boutons critiques ;
  - pas de retour des gradients/transparences sur surfaces principales.
- [x] Utiliser les scenarios docs-screenshots existants lorsque possible.
- [x] Regenerer les screenshots docs uniquement apres stabilisation du theme.

Validation :

```bash
npm --prefix frontend run docs:screenshots
npm --prefix frontend run docs:screenshots:check
npm --prefix frontend run build
```

Validation realisee le 2026-06-05 :

```bash
rtk npm exec -- tsc --noEmit --target ESNext --module ESNext --moduleResolution bundler --lib DOM,DOM.Iterable,ESNext --types node --skipLibCheck --resolveJsonModule --noImplicitAny false scripts/docs-screenshots/workspaceVisualQa.spec.ts
rtk npm --prefix frontend run typecheck
rtk npm --prefix frontend run test -- src/components/__tests__/Topbar.test.tsx src/components/__tests__/Sidebar.test.tsx src/components/__tests__/Layout.test.tsx src/components/__tests__/TopbarControlTrigger.test.tsx
rtk npm exec -- playwright test -c playwright.docs.config.ts workspaceVisualQa.spec.ts
rtk npm --prefix frontend run docs:screenshots
rtk npm --prefix frontend run build
rtk npm --prefix frontend run docs:screenshots:check
rtk git diff --check
```

## Etape 6 - Nettoyage Et Documentation

Objectif : eviter que le theme se re-fragmente apres le refacto.

- [ ] Supprimer les constantes/classes mortes devenues inutiles.
- [ ] Chercher les derniers styles locaux encore duplicatifs :

```bash
rtk rg -n "rounded-xl|rounded-2xl|shadow-xl|shadow-2xl|bg-gradient|backdrop-blur|bg-white/" frontend/src --glob '!**/*.test.*'
```

- [ ] Documenter dans une note developpeur courte :
  - quels tokens utiliser ;
  - quelles primitives utiliser pour cards, tables, toolbars, boutons,
    modales et menus ;
  - quels patterns eviter.
- [ ] Mettre a jour les pages utilisateur si leurs screenshots changent.
- [ ] Verifier que les changements restent purement frontend/theme.

Validation finale :

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend run docs:screenshots:check
```

## Definition De Done Globale

- [ ] Topbar/sidebar conservees comme reference visuelle.
- [ ] Contenu des workspaces aligne sur le shell.
- [ ] Cartes/panneaux majoritairement en 8px, surfaces opaques, bordures
  coherentes.
- [ ] Gradients, transparences, blur et ombres fortes reserves a des cas
  justifies.
- [ ] Tables et inventaires plus denses et plus lisibles.
- [ ] Code UI moins fragmente grace aux primitives partagees.
- [ ] Light/dark valides sur routes representatives.
- [ ] Aucun changement backend ou permission.

## Commandes Utiles

Audit visuel :

```bash
rtk rg -n "bg-gradient|from-|via-|to-|backdrop|bg-white/|dark:bg-[^ ]*/|rounded-(xl|2xl|3xl)|shadow-(lg|xl|2xl)|blur-" frontend/src --glob '!**/*.test.*'
```

Tests frontend frequents :

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test -- src/components
npm --prefix frontend run test:portal
npm --prefix frontend run build
```

Screenshots docs :

```bash
npm --prefix frontend run docs:screenshots
npm --prefix frontend run docs:screenshots:check
```

## Notes De Risque

- Le refacto peut modifier beaucoup de snapshots visuels : privilegier des
  lots petits et faciles a relire.
- Les pages `BrowserPage`, `BucketDetailPage` et `BucketOpsWorkbench` sont
  volumineuses : ne pas les traiter avant d'avoir stabilise les primitives.
- Les dashboards peuvent sembler plus simples apres reduction des effets :
  compenser par une meilleure hierarchie, pas par plus de decoration.
- Les changements dark mode doivent etre controles manuellement ou par
  screenshots, car les regressions de contraste y sont faciles.
