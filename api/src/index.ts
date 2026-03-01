import "dotenv/config";
import express from "express";
import { healthRouter } from "./routes/health.js";

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

app.use("/health", healthRouter);

app.listen(PORT, () => {
  console.log(`CIMScan API running at http://localhost:${PORT}`);
});
