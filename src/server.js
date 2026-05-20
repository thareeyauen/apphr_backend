import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import requestRoutes from './routes/requests.js';
import entitlementRoutes from './routes/entitlements.js';
import checkinRoutes from './routes/checkins.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/entitlements', entitlementRoutes);
app.use('/api/checkins', checkinRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`apphr-backend on http://localhost:${PORT}`));
