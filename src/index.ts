/**
 * IMPORTANT:
 * ---------
 * Do not manually edit this file if you'd like to host your server on Colyseus Cloud
 *
 * If you're self-hosting (without Colyseus Cloud), you can manually
 * instantiate a Colyseus Server as documented here:
 *
 * See: https://docs.colyseus.io/server/api/#constructor-options
 */
import { listen } from '@colyseus/tools';
import mongoose from 'mongoose';

/**
 * Connect to MongoDB
 */

mongoose.connect(process.env.DB_CONNECTION_STRING, {
  autoIndex: true,
});

// Import Colyseus config
import app from './app.config';

// Create and listen on 2567 (or PORT environment variable.)
listen(app);
