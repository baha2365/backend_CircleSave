require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const app = require('./app');
const env = require('./config/env');
const { disconnectDatabase } = require('./config/database');

const server = app.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT}`);
});


// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await disconnectDatabase();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await disconnectDatabase();
  server.close(() => process.exit(0));
});