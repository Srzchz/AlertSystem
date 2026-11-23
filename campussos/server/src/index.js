import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from './app.js';

const { server } = createApp();
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));

const port = process.env.PORT || 4000;
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => server.listen(port, () => console.log(`CampusSOS server on :${port}`)))
  .catch((e) => {
    console.error('MongoDB connection failed:', e.message);
    process.exit(1);
  });
