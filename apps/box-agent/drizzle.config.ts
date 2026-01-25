import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env.BOX_DB_PATH || ":memory:",
  },
});
