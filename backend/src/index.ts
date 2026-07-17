import express, { Request, Response, NextFunction } from "express";
import webhookRouter from "./routes/webhook";
import deploysRouter from "./routes/deploys";

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(express.json({ limit: "2mb" })); // diff payloads can be large

// Basic request logger
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Health check — used by Docker Compose and load balancers */
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/webhook", webhookRouter);
app.use("/deploys", deploysRouter);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err);
  res.status(500).json({ error: "Internal server error" });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? "4000", 10);

app.listen(PORT, () => {
  console.log(`🚀 Deploy Risk Advisor backend running on port ${PORT}`);
  console.log(`   Health:   GET  http://localhost:${PORT}/health`);
  console.log(`   Deploys:  GET  http://localhost:${PORT}/deploys`);
  console.log(`   Webhook:  POST http://localhost:${PORT}/webhook/deploy`);
});

export default app;
