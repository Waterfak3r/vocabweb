import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp({ frontendOrigins: config.frontendOrigins });

app.listen(config.port, () => {
  console.log(`Vacabweb backend listening on http://localhost:${config.port}`);
});
