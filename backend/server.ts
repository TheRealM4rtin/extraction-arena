import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import extractRouter from './routes/extract.js';
import llmRouter from './routes/llm.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use((req, res, next) => {
  const startedAt = Date.now();
  console.log(`[backend:http] ${req.method} ${req.originalUrl} started`);
  res.on('finish', () => {
    console.log(
      `[backend:http] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`
    );
  });
  next();
});
// 300 DPI page images are posted inline to /api/llm.
app.use(express.json({ limit: '100mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'cybertruck-doc-backend' });
});

app.use('/api', extractRouter);
app.use('/api', llmRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unexpected error.';
  const errStatus =
    err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
      ? err.status
      : undefined;
  // multer file-size / type errors land here. Preserve explicit parser statuses like 413.
  const status = errStatus ?? (/too large|Only PDF/i.test(message) ? 400 : 500);
  console.error(`[backend:error] ${status} ${message}`);
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[backend] Document backend listening on http://localhost:${PORT}`);
});
