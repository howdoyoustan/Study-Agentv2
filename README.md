# Study Agent V2

A PDF-based study assistant built on [Wipro AI Platform (WAIP)](https://docs.waip.wiprocms.com).  
Ask questions about your ingested PDFs and get structured, exam-ready answers with Mermaid diagrams, rendered in a clean UI and printable on a 57 mm thermal printer.

## Features

- Two-stage RAG pipeline: WAIP `doc_completion` retrieval → WAIP `completion` synthesis
- Structured answers: numbered sections, bold key terms, bullet lists, Mermaid TD diagrams
- Sources traceability tab showing every retrieved chunk with filename, page, and score
- Print button optimised for 57 mm thermal paper (zero margins, 8 pt Courier New)

## Local development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example file and fill in your values:

```bash
cp .env.local.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `WAIP_API_KEY` | Yes | Your WAIP bearer token |
| `WAIP_API_ENDPOINT` | Yes | `https://api.waip.wiprocms.com` |
| `WAIP_DATASET_ID` | Yes | Default dataset UUID (hardcoded fallback) |
| `WAIP_MODEL_NAME` | No | Override model, default `gpt-4o` |
| `NEXT_PUBLIC_WAIP_API_ENDPOINT` | Yes | Same endpoint, exposed to browser for direct uploads |
| `NEXT_PUBLIC_WAIP_API_KEY` | Yes | Same API key, exposed to browser for direct uploads |
| `NEXT_PUBLIC_WAIP_DATASET_ID` | Yes | Same dataset ID, pre-fills the UI field |

> **Note:** `NEXT_PUBLIC_*` variables are visible in the browser bundle. They are needed so the browser can upload large PDFs directly to WAIP, bypassing Next.js body-size limits. Keep this in mind if you share the deployment URL publicly.

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying to Vercel

### Step 1 — Push to GitHub

1. Create a new **empty** repository on [github.com/new](https://github.com/new) (no README, no .gitignore).
2. Copy the remote URL (e.g. `https://github.com/your-username/study-agent-v2.git`).
3. In this project folder run:

```bash
git remote add origin https://github.com/your-username/study-agent-v2.git
git push -u origin main
```

### Step 2 — Import on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and click **Import Git Repository**.
2. Select your `study-agent-v2` repo.
3. Framework preset will auto-detect as **Next.js** — leave all build settings as-is.
4. Before clicking Deploy, open **Environment Variables** and add every variable from the table above with your real values.
5. Click **Deploy**.

### Step 3 — Function timeout (important)

WAIP synthesis calls regularly take 15–30 seconds.  
- **Vercel Hobby** plan caps serverless functions at **10 seconds** — queries will time out.  
- **Vercel Pro** plan allows up to **60 seconds** — the route is already configured with `maxDuration = 60`.  

Upgrade to Pro before deploying, or the Ask button will always return a timeout error.

## Workflow

```
Create dataset → Ingest PDFs → Prepare Index → Ask questions
```

1. **Create dataset** — give it a name; the generated UUID fills the Active Dataset ID field.
2. **Ingest PDFs** — files are uploaded directly from the browser to WAIP (no size limit via the XHR path).
3. **Prepare Index** — triggers WAIP to build the vector index. Wait ~1–2 minutes before querying.
4. **Ask** — type your question and hit Ask. The Sources tab shows every retrieved chunk for traceability.
5. **Print** — click Print Answer to send to your thermal printer (57 mm roll, zero margins).
