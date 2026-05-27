import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admins.js';
import requestRoutes from './routes/requests.js';
import entitlementRoutes from './routes/entitlements.js';
import checkinRoutes from './routes/checkins.js';
import settingsRoutes from './routes/settings.js';
import lookupsRoutes from './routes/lookups.js';

const app = express();
const allowedOrigins = process.env.CORS_ORIGIN?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins?.length ? allowedOrigins : true,
    credentials: true,
  }),
);
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/admins', adminRoutes);
app.use('/requests', requestRoutes);
app.use('/entitlements', entitlementRoutes);
app.use('/checkins', checkinRoutes);
app.use('/settings', settingsRoutes);
app.use('/lookups', lookupsRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`apphr-backend on http://localhost:${PORT}`),
);
