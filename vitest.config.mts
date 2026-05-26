import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
    test: {
        // mode defines what ".env.{mode}" file to choose if exists
        env: loadEnv(mode, process.cwd(), ''),
        fileParallelism: false,
        coverage: {
            reporter: ['text', 'json-summary', 'json'],
            enabled: true,
            provider: 'v8', // or 'istanbul'
            reportOnFailure: true,
        },
    },
}));