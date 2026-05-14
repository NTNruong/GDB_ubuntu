import { createRunnerServer } from "./app.js";
import { readConfig } from "./config.js";

const config = readConfig();
const app = createRunnerServer(config);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
