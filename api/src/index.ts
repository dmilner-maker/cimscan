import "dotenv/config";
import express from "express";

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "cimscan-api" });
});

app.listen(PORT, () => {
  console.log(`CIMScan API running at http://localhost:${PORT}`);
});
