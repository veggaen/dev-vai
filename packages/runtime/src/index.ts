import 'dotenv/config';
import { createServer } from './server.js';

const { app, port } = await createServer();

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`VAI runtime listening on http://localhost:${port}`);
} catch (err) {
  console.error('Failed to start server:', err);
  process.exit(1);
}
