import "dotenv/config";
import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.js";
import { ingestRouter } from "./routes/ingest.js";
import { dealsRouter } from "./routes/deals.js";

const app = express();
const PORT = process.env.PORT || 3002;

const WEB_URL = process.env.WEB_URL ?? "https://web-production-4a3e0.up.railway.app";

app.use(cors({ origin: WEB_URL }));
app.use(express.json());

app.use("/health", healthRouter);
app.use("/api/email/ingest", ingestRouter);
app.use("/api/deals", dealsRouter);

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`CIMScan API running at http://localhost:${PORT}`);
});
