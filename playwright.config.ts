import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    headless: false, // Extensions require headed mode
  },
  projects: [
    {
      name: 'chromium',
      use: {
        channel: 'chromium',
      },
    },
  ],
});
