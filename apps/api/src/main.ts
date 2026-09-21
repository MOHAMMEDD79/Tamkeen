import { loadConfig } from '@tamkeen/config';
import { createApp } from './app.js';

try {
  const config = loadConfig(process.env);
  const app = await createApp(config);
  await app.listen(config.apiPort, config.apiHost);
  console.log(JSON.stringify({ service: 'api', event: 'listening', port: config.apiPort, environment: config.environment }));
} catch {
  console.error('API startup failed. Check configuration and local dependencies; secrets are not logged.');
  process.exitCode = 1;
}
