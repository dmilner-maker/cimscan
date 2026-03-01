# CIMScan

A SaaS application monorepo with a Next.js frontend and Express API backend.

## Structure

- **`/web`** – Next.js 14 frontend (TypeScript, Tailwind CSS, Shadcn/ui)
  - Deploy to [Vercel](https://vercel.com) for serverless hosting
- **`/api`** – Express API backend (TypeScript, dotenv, Zod)
  - Deploy to [Railway](https://railway.app) for server hosting

## Getting Started

### Prerequisites

- Node.js 18+
- npm (or pnpm/yarn)

### Install Dependencies

From the root directory:

```bash
npm install
```

### Run Locally

Start both apps in development mode:

```bash
npm run dev
```

Or run them individually:

```bash
npm run dev:web   # Frontend at http://localhost:3000
npm run dev:api   # API at http://localhost:3001
```

### Build

Build all workspaces:

```bash
npm run build
```
