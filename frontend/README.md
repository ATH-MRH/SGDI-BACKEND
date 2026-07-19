# Frontend SGDI/ATLAS — reconstruction (v2)

Monorepo Vue 3 + Vite. Stratégie **strangler** : ce nouveau front coexiste avec l'ancien
(`app/static/`, **intact**, servi à la racine comme **repère de parité**). Le neuf est servi
par FastAPI sous **`/v2`**.

## Structure

```
frontend/
  packages/shared/   @sgdi/shared — client API typé, design tokens, types (miroir backend)
  apps/admin/        @sgdi/admin  — back-office unifié (SGDI + ERP), Vite + Vue 3 + Pinia + Router (hash)
```

## Développement

```bash
cd frontend
npm install
npm run dev:admin      # http://localhost:5173/v2/  (proxy /api -> http://127.0.0.1:8000)
```

Lancer le backend FastAPI en parallèle (uvicorn) pour l'authentification réelle.

## Build (servi par FastAPI sur /v2)

```bash
cd frontend
npm run build:admin    # sortie: frontend/apps/admin/dist
```

FastAPI monte `frontend/apps/admin/dist` sur `/v2` si le build existe (voir `app/main.py`).

## Principes (cf. docs/ARCHITECTURE-RECONSTRUCTION.md)

- Parité fonctionnelle totale ; on ne change que l'UI/UX + la perf.
- Logique métier au backend ; le front ne fait que de l'UX.
- Autorisation serveur réelle (niveau H1–H5 + société) — déjà en place côté API.
- Pas de snapshot global : chaque écran charge sa donnée via REST paginé.
