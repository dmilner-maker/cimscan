import "dotenv/config";
import express from "express";
import { healthRouter } from "./routes/health.js";

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

app.use("/health", healthRouter);

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`CIMScan API running at http://localhost:${PORT}`);
});
