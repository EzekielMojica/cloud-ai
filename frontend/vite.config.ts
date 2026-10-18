import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // Port 5173 is allowed in the Lambda's CORS list in template.yaml.
  server: { port: 5173, strictPort: true },
});
