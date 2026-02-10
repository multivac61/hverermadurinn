// See https://svelte.dev/docs/kit/types#app.d.ts

declare global {
  namespace App {
    interface Platform {
      env: {
        DB: D1Database;
        ADMIN_TOKEN?: string;
        CF_ADMIN_TOKEN?: string;
        LLM_PROVIDER?: string;
        LLM_MODEL?: string;
        LLM_BASE_URL?: string;
        LLM_API_KEY?: string;
        FORCE_ROUND_OPEN?: string;
        DEV_RANDOM_ROUND_PER_SESSION?: string;
      };
    }
  }
}

export {};
