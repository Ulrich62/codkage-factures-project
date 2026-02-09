# CODKAGE Factures

Générateur de factures avec base de données Neon (PostgreSQL).

## Déploiement sur Netlify

### Option 1: Netlify CLI (le plus rapide)

```bash
# Installer Netlify CLI
npm install -g netlify-cli

# Se connecter
netlify login

# Lier au site existant
netlify link --name <ton-site-name>

# Déployer
netlify deploy --build --prod
```

### Option 2: Git (déploiement automatique)

1. Push ce dossier sur GitHub
2. Sur Netlify → "Add new site" → "Import from Git"
3. Sélectionne le repo
4. Build command: `npm run build`
5. Publish directory: `dist`

### Base de données

La base Neon est déjà connectée via `NETLIFY_DATABASE_URL`.
Au premier chargement, l'app crée automatiquement les tables.

## Structure

```
├── netlify/functions/api.mjs  → API serverless (CRUD)
├── src/App.jsx                → Interface React
├── src/api.js                 → Client API frontend
├── src/pdfBuilder.js          → Génération PDF (jsPDF)
├── netlify.toml               → Config Netlify
└── vite.config.js             → Config Vite
```
