import { app } from './app.js';

const PORT = process.env.PORT_API || 3001;

app.listen(PORT, () => {
  console.log(`[API] Server läuft auf Port ${PORT}`);
});
