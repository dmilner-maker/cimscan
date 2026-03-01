import "dotenv/config";
import express from "express";
import { healthRouter } from "./routes/health.js";
import { ingestRouter } from "./routes/ingest.js";

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

app.use("/health", healthRouter);
app.use("/api/email/ingest", ingestRouter);

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`CIMScan API running at http://localhost:${PORT}`);
});
