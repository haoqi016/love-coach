import { pathToFileURL } from 'node:url';

import { createApp } from './app.js';
import { loadConfig } from './config.js';

export { createApp } from './app.js';
export type { CreateAppOptions } from './app.js';
export type {
  ImageTextExtractor,
  ImageTextExtraction,
  ImageTextExtractionOptions,
  ScreenshotInput
} from './image-extractor.js';

function start(): void {
  const config = loadConfig();
  const app = createApp({ config });
  app.listen(config.port, '0.0.0.0', () => {
    process.stderr.write(`@alc/server listening on port ${config.port}\n`);
  });
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  start();
}
