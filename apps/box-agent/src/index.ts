import "./db/migrate"; // Run migrations on startup
import server from "./server";

Bun.serve(server);
