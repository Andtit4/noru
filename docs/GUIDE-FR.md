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

Ce qui ne marche pas encore : les server actions (`'use server'`), le rendu côté serveur (le
référencement Google voit une page construite en JavaScript). Les pages `async` appellent leurs API
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

## 7. Limites actuelles et prochaines étapes

Pas encore supporté : Vue/Svelte, Sass/Less, découpage du code (code splitting), scope hoisting,
source maps, plugins, fichier de config.

Pistes, par ordre d'intérêt :

1. **Next.js côté serveur** : server actions, puis rendu côté serveur (les routes API et le
   middleware sont faits depuis la v0.3).
2. **Code splitting** : un fichier par page / par `import()` dynamique (le JavaScript d'un gros
   projet Next serait téléchargé page par page, comme avec Next).
3. **Scope hoisting** : supprimer l'enveloppe de chaque module (le reste de l'écart de taille avec
   Vite sur les très gros projets).
4. **Source maps** : voir son vrai code TypeScript dans les outils du navigateur.
5. **Cache sur disque** : démarrage encore plus rapide des gros projets.
6. **Vue** (via `@vue/compiler-sfc`) et **Sass**.
