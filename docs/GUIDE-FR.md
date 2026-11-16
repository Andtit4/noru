# Guide noru (en français)

Ce guide explique comment travailler sur noru, le tester et le publier sur npm, sans avoir besoin
de connaître Rust.

## 1. Ce que fait noru

noru est un **bundler** : il prend une app React + TypeScript (même structure qu'un projet Vite) et
produit un dossier `dist/` prêt à mettre en ligne. Il est écrit en Rust, donc très rapide.

| Commande      | Rôle                                                                               |
| ------------- | ---------------------------------------------------------------------------------- |
| `noru dev`    | Serveur de développement (port 3000 par défaut, `--port 4000` pour changer)       |
| `noru build`  | Build de production dans `dist/`                                                   |
| `noru start`  | Sert le dossier `dist/` (pour la production, utilise la variable `PORT` si définie) |
| `noru preview`| Comme `start`, sur `localhost:4173`                                                |

Dans un projet, on les met dans les scripts du `package.json`, puis `npm run dev` / `npm run build` /
`npm start` :

```json
"scripts": { "dev": "noru dev --port 3000", "build": "noru build", "start": "noru start" }
```

### Pourquoi le dev est rapide (le problème « Next.js qui compile chaque page »)

En dev, Next.js (ou Vite) compile les pages / modules **au moment où tu les ouvres** : sur un gros
projet, chaque nouvelle page fait attendre. noru fait l'inverse : **tout est compilé au démarrage**
(en parallèle, en quelques centaines de millisecondes), puis gardé en mémoire. Quand tu modifies un
fichier, **seul ce fichier** est recompilé (quelques ms) et le navigateur se recharge tout seul.

Mesuré sur ton PC avec une app de 5 000 composants : page affichée en **1,8 s avec noru contre
34,9 s avec Vite** au premier chargement.

### Hot reload (les modifications appliquées sans perdre l'état)

| Tu modifies…                      | Ce qui se passe dans le navigateur                                   |
| --------------------------------- | -------------------------------------------------------------------- |
| un **composant React** (`.tsx`)   | mis à jour **sans recharger**, l'état (compteurs, formulaires…) reste |
| un **fichier CSS**                | appliqué en direct, sans recharger                                   |
| un **nouveau fichier** + import   | pris en compte en direct, sans recharger                             |
| un fichier utilitaire (`.ts`)     | les composants qui l'utilisent sont mis à jour, sans recharger       |
| une **erreur de syntaxe**         | message d'erreur affiché ; une fois corrigé, mis à jour sans recharger |
| `main.tsx` ou **`index.html`**    | la page se recharge (c'est le squelette de l'app, comme avec Vite)   |

Sur l'app de 5 000 composants, une modification de composant apparaît en **~0,2 s**. Techniquement,
c'est React Fast Refresh (le même mécanisme que Vite) : noru n'envoie au navigateur que les modules
modifiés, et React rafraîchit les composants en gardant leur état.

⚠️ noru ne fait **pas** tourner de projets Next.js (rendu serveur, routes API, Server Components) :
il vise les apps React « côté client » (type Vite / Create React App).

## 2. Organisation du dépôt

```
crates/noru_core/     Le cœur en Rust : analyse, transformation, bundling, serveur de dev
  src/js.rs           Traitement des fichiers JS/TS (imports, exports, require, constantes)
  src/css.rs          CSS, CSS Modules, url()
  src/graph.rs        Graphe des modules, traitement en parallèle, cache
  src/bundle.rs       Assemblage du bundle final + minification
  src/dev.rs          Serveur de dev (rechargement auto, overlay d'erreur)
  src/serve.rs        Serveur de fichiers pour `start` / `preview`
  src/runtime.js      Petit runtime JS inclus dans chaque bundle
  src/client.js       Script injecté en dev (hot updates, mise à jour CSS, erreurs)
  src/hmr-runtime.js  Runtime du hot reload (remplacement des modules + React Fast Refresh)
  src/treeshake.rs    Tree-shaking (suppression du code inutilisé)
  src/production.rs   Build de production : Brotli/gzip, poids des pages, service worker, rapport
  src/images.rs       Images : dimensions, aperçu flou, versions AVIF/WebP (via sharp)
  src/fonts.rs        Polices Google téléchargées au build
  src/next/           Projets Next.js : routeur, modules next/*, middleware et routes API, pré-rendu
  src/vendor/         Runtime React Refresh (licence MIT, Meta)
crates/noru_cli/      La commande `noru` en Rust (pour développer et tester vite)
packages/noru/        Le package npm : module natif Node (napi-rs) + commande `noru` en JS
  npm/                Un sous-package par plateforme (@titoandele/noru-win32-x64-msvc, ...)
fixtures/             Projets de test : react-ts (template Vite) et features (33 auto-tests)
scripts/              Tests de bout en bout, benchmarks, générateur de gros projet
.github/workflows/    CI (tests à chaque push) et Release (publication npm sur un tag)
```

## 3. Tester (à faire après chaque modification)

Comme tu ne relis pas le Rust, **ce sont les tests qui garantissent que tout marche**. Depuis la
racine du projet, dans Git Bash :

```bash
export PATH="$HOME/.cargo/bin:$PATH"    # si `cargo` n'est pas trouvé

cargo build --release                   # compile noru (2-5 min la première fois)
cargo test --workspace                  # tests unitaires
node scripts/e2e.mjs                    # builde les projets de test et les ouvre dans Edge/Chrome
node scripts/e2e-dev.mjs                # teste le serveur de dev (hot reload, état conservé, CSS, erreurs)
node scripts/e2e-next.mjs               # teste un projet Next.js (routes, pages async, Tailwind, hot reload)
```

Tout doit afficher des ✓. Le test du package npm :

```bash
cd packages/noru
node node_modules/@napi-rs/cli/dist/cli.js build --platform --js binding.js --dts binding.d.ts
npm test
```

> Sur ton PC, `npx` reste bloqué (stratégie de l'entreprise) : appelle les outils avec `node ...`
> comme ci-dessus. PowerShell est aussi bloqué : utilise Git Bash.

## 4. Essayer noru sur un de tes projets

```bash
cargo build --release
./target/release/noru.exe dev  chemin/vers/ton-projet --port 3000
./target/release/noru.exe build chemin/vers/ton-projet
./target/release/noru.exe start chemin/vers/ton-projet
```

Deux sortes de projets marchent :

- un projet **React de type Vite** : un `index.html` à la racine avec
  `<script type="module" src="/src/main.tsx">` ;
- un projet **Next.js App Router** (un dossier `app/` ou `src/app/`) : rien à changer, il suffit de
  remplacer `next dev` / `next build` / `next start` par `noru dev` / `noru build` / `noru start`.

### Projets Next.js : comment ça marche

noru n'utilise pas le serveur de Next.js : il lit le dossier `app/` et fabrique un petit routeur qui
fait tourner les pages **dans le navigateur**. Tout le projet est compilé au démarrage, donc ouvrir une page est
instantané (pas de « Compiling… » à chaque nouvelle page comme avec `next dev`).

Ce qui marche : layouts, groupes `(groupe)`, routes dynamiques `[id]` et `[...slug]`, `loading`,
`error`, `not-found`, `metadata`, `next/link`, `next/navigation`, `next/image`, `next/font/google`,
`next/dynamic`, les pages `async` (elles s'exécutent dans le navigateur), `NEXT_PUBLIC_*`, Tailwind
v3 et v4. En dev, un import cassé ne casse que la page qui l'utilise.

**Le middleware et les routes API** (`middleware.ts` / `proxy.ts`, `route.ts`) tournent dans un
processus Node.js lancé par noru à côté du serveur : redirections, réécritures, cookies, `matcher`,
`next/server`, `next/headers` (`cookies()`, `headers()`), et toutes les variables du `.env` (secrets
compris, uniquement côté serveur). Le middleware s'exécute aussi avant les navigations dans
l'application, comme avec Next. Les paquets npm (next-auth...) sont chargés depuis `node_modules`.
`noru build` met ce code serveur dans `dist/server/` (jamais envoyé au navigateur) et `noru start`
l'exécute : le serveur de production a donc besoin du `node_modules` et des fichiers `.env`.

Ce qui ne marche pas encore : les server actions (`'use server'`), le rendu sur le serveur à chaque
requête (les pages statiques sont pré-rendues au build, voir la partie 7 ; les autres sont
construites dans le navigateur). Les pages `async` appellent leurs API
depuis le navigateur : ces API doivent l'accepter (CORS) et les secrets serveur ne leur sont pas
disponibles.

Testé sur 5 vrais projets Next (Next 14 et 16, Tailwind v3 et v4, jusqu'à 4 100 modules, next-auth).

## 5. Publier sur npm

Ce qui est publié : le paquet `noru` (JS + commande) et 8 paquets `@titoandele/noru-<plateforme>`
qui contiennent le binaire natif (npm n'installe que celui de la machine). Pourquoi l'organisation
`titoandele` : le scope `@noru` appartient déjà à quelqu'un d'autre, et npm bloque les noms sans
scope du type `noru-win32-x64-msvc` (« spam detection »). Le token npm doit pouvoir publier dans
l'organisation `titoandele`.

À faire une seule fois :

1. **Créer le dépôt GitHub** `Andtit4/noru` (public, vide : sans README ni licence) et y pousser
   ce dossier.
2. Sur [npmjs.com](https://www.npmjs.com) : créer un compte, puis un **token** : *Access Tokens →
   Generate New Token → Granular Access Token*, permissions *Read and write* sur *All packages*
   (les paquets n'existent pas encore), en cochant *Bypass 2FA* si l'option est proposée.
3. Dans GitHub : *Settings → Secrets and variables → Actions → New repository secret*, nom
   `NPM_TOKEN`, valeur = le token.
4. Facultatif mais conseillé : *Actions → Release → Run workflow*. Ça compile les 8 binaires et les
   teste **sans rien publier**.

Publier une version :

```bash
git tag v0.1.0 && git push origin v0.1.0     # première version

# versions suivantes :
cd packages/noru
npm version patch        # 0.1.0 -> 0.1.1 (crée le commit et le tag v0.1.1)
cd ../..
git push && git push --tags
```

Le workflow **Release** compile noru pour Windows, macOS et Linux (8 binaires), vérifie que le tag
correspond à la version du `package.json`, puis publie le tout sur npm. Ensuite n'importe qui peut
faire `npm install -D noru-bundler` (npm refuse le nom `noru`, trop proche de `node`, `nopt`,
`ora`... ; la commande, elle, reste `noru`).

> Une version publiée sur npm ne peut plus être republiée ni vraiment supprimée : en cas de
> problème, on corrige et on publie la version suivante.

## 6. Tree-shaking (suppression du code inutilisé)

Activé par défaut sur `noru build` (désactivable avec `--no-treeshake` si un jour quelque chose
casse). noru retire :

- les **modules entiers** dont rien n'est utilisé (s'ils n'ont pas d'effet de bord) ;
- les **exports inutilisés** et le code qui ne sert qu'à eux, à l'intérieur des modules gardés ;
- dans les fichiers « barrel » (`export * from './a'`), seuls les modules réellement utilisés restent ;
- le **CSS et les images** des modules retirés.

Il respecte le champ `"sideEffects"` des `package.json` (c'est ce qui permet de vider `lodash-es`
ou `lucide-react`) et les annotations `/* @__PURE__ */`. Exemple mesuré (`fixtures/treeshake`) :
**1 134 Ko → 231 Ko** (2 159 modules sur 2 211 retirés), quasiment la même taille que Vite.

En mode `dev`, le tree-shaking est désactivé pour garder des rebuilds instantanés.

## 7. Le build de production (v1.1)

`noru build` prépare l'application pour de vrais visiteurs, y compris avec une connexion lente ou
instable. Tout est activé par défaut ; chaque fonction a une option pour la couper.

- **Découpage du code** : chaque page ne télécharge que son code (un morceau par page, layout et
  composant `next/dynamic`). Le code commun à plusieurs pages va dans des morceaux partagés, et les
  morceaux de la page demandée partent en même temps que le fichier principal. `--no-split` pour un
  seul fichier. Sur l'appli de test de 50 pages : **80 Ko** de JavaScript par page (gzip) au lieu
  de 229 Ko, contre 141 Ko pour Next.js.
- **Fichiers précompressés** : chaque fichier texte est écrit avec une version Brotli (`.br`) et
  gzip (`.gz`), compressées une fois pour toutes au build. `noru start` les envoie tels quels.
- **Pages pré-rendues (Next.js)** : les pages statiques sont transformées en HTML au build
  (`dist/about/index.html`...), avec leur titre et leur description. Le visiteur voit le contenu
  avant que le JavaScript soit téléchargé, et Google aussi. L'application prend ensuite le relais.
  Les pages impossibles à rendre au build (routes `[id]`, `redirect()`, appels à des URL
  relatives...) gardent la page vide habituelle et sont listées à la fin du build.
  `--no-prerender` pour couper.
- **Hors ligne et visites suivantes instantanées** : un service worker (`sw.js`) garde la coquille
  de l'appli et les fichiers dans le navigateur. Les visites suivantes ne les retéléchargent pas,
  les pages déjà vues s'ouvrent sans réseau, et sur une bonne connexion le reste de l'appli est
  téléchargé en arrière-plan (jamais en mode économie de données ni en 2G). `--no-offline` pour
  couper ; si tu as ton propre `public/sw.js`, noru le garde et n'en génère pas.
- **Préchargement selon le réseau (Next.js)** : `next/link` télécharge les pages avant le clic :
  les liens visibles sur une bonne connexion, seulement le lien survolé ou touché en 3G, rien en
  2G ni en mode économie de données.
- **Images optimisées (Next.js)** : `import photo from "./photo.jpg"` donne à `next/image` la
  largeur et la hauteur (la page ne saute plus quand l'image arrive). Si `sharp` est installé (Next
  l'installe), noru génère aussi un aperçu flou (`placeholder="blur"`) et des versions AVIF / WebP
  en plusieurs largeurs : un téléphone télécharge une petite image moderne au lieu de l'originale.
  Les images encodées sont gardées dans `node_modules/.noru-cache/` : les builds suivants sont
  rapides.
- **Polices Google hébergées avec le site (Next.js)** : les polices de `next/font/google` sont
  téléchargées au build et servies par le site (aucune requête vers Google, la police principale
  est préchargée). En `noru dev`, le navigateur les charge toujours depuis Google.
- **Poids des pages et budget** : le build affiche ce que chaque page télécharge à la première
  visite (JS + CSS, Brotli) et une estimation en 3G lente et en 4G. `--budget 150` (ou
  `"noru": { "budget": 150 }` dans `package.json`) fait échouer le build si une page dépasse
  150 Ko ; `--report` écrit `noru-report.html`, qui montre de quoi le JavaScript est fait.

Hébergement statique : sers le dossier `dist/`. Les pages qui ont leur propre `index.html` sont
servies telles quelles, et les autres URL doivent renvoyer vers `shell.html` (la page vide de
l'appli, aussi utilisée hors ligne).

Pour voir où passe le temps du build : `NORU_PROFILE=1 noru build`.

## 8. noru play : des jeux dans tes sites

Le paquet `noru-play` (`packages/noru-play/`) permet de mettre des jeux web dans un site Next.js.
Il a deux côtés :

- **dans le jeu**, le SDK `play` (environ 2 Ko compressé) : `play.firstFrameReady()` et
  `play.gameReady()` (fin du chargement), `play.onPause` / `play.onResume`,
  `play.onAudioChange`, `play.save()` / `play.load()` (la progression), `play.sendScore()`,
  `play.language`, `play.player` (le nom et la photo de l'utilisateur connecté au site) ;
- **dans la page**, le composant `<Playable src="/games/cloud-acres/" />` : il affiche un écran de
  chargement jusqu'à la première image, met le jeu en pause quand l'onglet est caché ou que le jeu
  sort de l'écran, coupe le son si on le demande, et reçoit les scores et les sauvegardes. Par
  défaut les sauvegardes vont dans le navigateur (`localStorage`) ; pour les garder sur ton
  serveur, passe `storage={{ load, save }}` qui appellent ton API. Pour montrer l'utilisateur
  connecté dans le jeu : `player={{ name: user.name, avatar: user.image }}` (la photo doit venir du
  même site ou être une image `data:`).

Ouvert tout seul (pendant que tu le développes avec `noru dev`), un jeu marche aussi : les
sauvegardes vont dans le navigateur et les scores dans la console.

Faire un jeu et le mettre dans un site :

```bash
noru dev examples/play/cloud-acres                                       # développer le jeu
noru build examples/play/cloud-acres --base /games/cloud-acres/ --no-offline
# puis copier examples/play/cloud-acres/dist/ vers <ton-site>/public/games/cloud-acres/
```

Le premier jeu, **Cloud Acres** (`examples/play/cloud-acres/`), est une ferme vue de dessus :

- **les champs** : on glisse le doigt dessus pour planter la graine choisie et récolter ce qui est
  mûr (blé, carotte, maïs, tomate, citrouille), avec un combo quand on récolte beaucoup d'un coup ;
- **les animaux** : poules, vaches, cochons, moutons, à nourrir avec les récoltes (œufs, lait,
  truffes, laine) ;
- **les ateliers** : moulin, fromagerie, atelier de laine, boulangerie, avec une file de 3
  productions (farine, fromage, pull, gâteau) ;
- **les commandes** des villageois (le tableau), qui rapportent pièces et expérience ;
- **les niveaux** débloquent cultures, champs, enclos et ateliers à acheter ;
- **la ferme continue de travailler pendant l'absence** (jusqu'à 12 heures) ; au retour, un message
  dit ce qui est prêt ;
- **le fermier** marche sur la carte jusqu'à ce que le joueur touche ; on le personnalise (peau,
  chapeau, chemise, salopette) en touchant le portrait en haut à gauche, qui montre la photo de
  l'utilisateur du site quand le site la donne ;
- **la boutique** : terrains à défricher (nord, sud) avec de nouveaux champs, **tracteur** (on
  choisit l'outil tracteur puis un champ : il le récolte et le replante tout seul), **camion de
  livraison** (il livre les commandes prêtes tout seul, même pendant l'absence), arrosage (pousse
  plus rapide), silos (grange plus grande, elle a maintenant une limite) et décorations à placer où
  l'on veut (fleurs, botte de foin, banc, lampadaire, épouvantail, fontaine).

Tout est dessiné par le code (aucune image). On se déplace en glissant hors des
champs, on zoome avec deux doigts ou la molette. Pour essayer vite : `?speed=10` accélère le temps.
Le jeu s'inspire des mécaniques classiques des jeux de ferme, avec son propre nom, ses personnages
et ses graphismes.

Test automatique : `node scripts/e2e-play.mjs target/debug/noru.exe` (le SDK, `<Playable>` dans une
page Next et Cloud Acres, dans un vrai navigateur).

## 9. Limites actuelles et prochaines étapes

Pas encore supporté : Vue/Svelte, Sass/Less, scope hoisting, source maps, plugins, fichier de
config.

Pistes, par ordre d'intérêt :

1. **Next.js côté serveur** : server actions, puis rendu côté serveur (les routes API et le
   middleware sont faits depuis la v0.3).
2. **Scope hoisting** : supprimer l'enveloppe de chaque module (le reste de l'écart de taille avec
   Vite sur les très gros projets).
3. **Source maps** : voir son vrai code TypeScript dans les outils du navigateur.
4. **Cache sur disque** : démarrage encore plus rapide des gros projets.
5. **Vue** (via `@vue/compiler-sfc`) et **Sass**.
