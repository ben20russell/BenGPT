## SearchAI

SearchAI is a Next.js app deployed on Vercel:
- Production project: `searchai`
- Vercel dashboard: `https://vercel.com/ben20russell/searchai/`

## Local development

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Deployment connectivity

Renaming a Vercel project in the dashboard does not break Git-based deployments by itself. If you deploy with Vercel CLI from this folder, link locally to the renamed project:

```bash
vercel link --project searchai --scope ben20russell
```

Then pull the environment variables:

```bash
vercel env pull .env.local
```
