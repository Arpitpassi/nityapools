import express, { json } from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import cors from 'cors';
import { createHash } from 'crypto';
import { POOL_WALLETS_DIR, POOLS_FILE, loadPools, savePools, getPoolBalance, updatePool, createPool } from './poolManager.js';
import { handleCreditSharing } from './creditSharing.js';

const app = express();

// Enable CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Event-Pool-Id']
}));
app.use(json());

// Ensure pool_wallets directory exists
if (!existsSync(POOL_WALLETS_DIR)) {
  mkdirSync(POOL_WALLETS_DIR, { recursive: true });
  console.log(`Created pool wallets directory: ${POOL_WALLETS_DIR}`);
}

// Ensure support.json exists
const SUPPORT_FILE = 'support.json';
if (!existsSync(SUPPORT_FILE)) {
  writeFileSync(SUPPORT_FILE, JSON.stringify({ link: '' }, null, 2));
  console.log(`Created support file: ${SUPPORT_FILE}`);
}

// Log directory paths at startup
console.log(`POOLS_FILE: ${POOLS_FILE}`);
console.log(`POOL_WALLETS_DIR: ${POOL_WALLETS_DIR}`);
console.log(`SUPPORT_FILE: ${SUPPORT_FILE}`);

// API key
const DEPLOY_API_KEY = 'deploy-api-key-123';

// Handle uncaught exceptions and rejections
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Middleware to validate API key
app.use((req, res, next) => {
  const apiKey = req.header('X-API-Key');
  const path = req.path;

  console.log(`[${new Date().toISOString()}] Request to ${path} with headers:`, {
    'X-API-Key': apiKey,
    'X-Event-Pool-Id': req.header('X-Event-Pool-Id')
  });

  if (path === '/health' || path === '/pools' || path === '/support-link') {
    next();
    return;
  }

  if (!apiKey || apiKey !== DEPLOY_API_KEY) {
    console.error(`[${new Date().toISOString()}] Invalid or missing API key for ${path}`);
    return res.status(401).json({ error: 'Invalid or missing API key', code: 'INVALID_API_KEY' });
  }

  next();
});

// Middleware to filter pools by creator address
app.use('/pools', (req, res, next) => {
  const creatorAddress = req.query.creatorAddress;
  if (!creatorAddress) {
    return res.status(400).json({ error: 'Missing creatorAddress query parameter', code: 'MISSING_CREATOR_ADDRESS' });
  }
  const pools = loadPools();
  const filteredPools = Object.fromEntries(
    Object.entries(pools).filter(([_, pool]) => pool.creatorAddress === creatorAddress)
  );
  res.json(filteredPools);
});

// Health check endpoint
app.get('/health', (req, res) => {
  console.log(`[${new Date().toISOString()}] Health check successful`);
  res.status(200).json({ status: 'ok' });
});

// Endpoint to get pool balance
app.get('/pool/:id/balance', async (req, res) => {
  try {
    const poolId = req.params.id;
    const creatorAddress = req.query.creatorAddress;
    const pools = loadPools();
    const pool = pools[poolId];
    if (!pool) {
      return res.status(404).json({ error: 'Pool not found', code: 'POOL_NOT_FOUND' });
    }
    if (pool.creatorAddress !== creatorAddress) {
      return res.status(403).json({ error: 'Unauthorized: You do not own this pool', code: 'UNAUTHORIZED' });
    }
    const balance = await getPoolBalance(poolId);
    res.json({ balance });
  } catch (error) {
    console.error(`Error fetching balance for pool ${req.params.id}:`, error);
    res.status(500).json({ error: error.message, code: error.code || 'UNKNOWN_ERROR' });
  }
});

// Endpoint to get pool wallet (password protected)
app.get('/pool/:id/wallet', async (req, res) => {
  try {
    const poolId = req.params.id;
    const creatorAddress = req.query.creatorAddress;
    const password = req.query.password;
    if (!password) {
      return res.status(400).json({ error: 'Password required', code: 'MISSING_PASSWORD' });
    }
    const pools = loadPools();
    const pool = pools[poolId];
    if (!pool) {
      return res.status(404).json({ error: 'Pool not found', code: 'POOL_NOT_FOUND' });
    }
    if (pool.creatorAddress !== creatorAddress) {
      return res.status(403).json({ error: 'Unauthorized: You do not own this pool', code: 'UNAUTHORIZED' });
    }
    const passwordHash = createHash('sha256').update(password).digest('hex');
    if (pool.passwordHash !== passwordHash) {
      return res.status(403).json({ error: 'Invalid password', code: 'INVALID_PASSWORD' });
    }
    const walletPath = pool.walletPath;
    if (!existsSync(walletPath)) {
      return res.status(404).json({ error: 'Wallet file not found', code: 'WALLET_NOT_FOUND' });
    }
    const wallet = JSON.parse(readFileSync(walletPath, 'utf-8'));
    console.log(`[${new Date().toISOString()}] Wallet downloaded for pool ${poolId} by creator ${creatorAddress}`);
    res.json({ wallet });
  } catch (error) {
    console.error(`Error fetching wallet for pool ${req.params.id}:`, error);
    res.status(500).json({ error: error.message, code: error.code || 'UNKNOWN_ERROR' });
  }
});

// Endpoint to update a pool (password protected)
app.patch('/pool/:id/edit', (req, res) => {
  try {
    const poolId = req.params.id;
    const creatorAddress = req.query.creatorAddress;
    const password = req.query.password;
    if (!password) {
      return res.status(400).json({ error: 'Password required', code: 'MISSING_PASSWORD' });
    }
    const pools = loadPools();
    const pool = pools[poolId];
    if (!pool) {
      return res.status(404).json({ error: 'Pool not found', code: 'POOL_NOT_FOUND' });
    }
    if (pool.creatorAddress !== creatorAddress) {
      return res.status(403).json({ error: 'Unauthorized: You do not own this pool', code: 'UNAUTHORIZED' });
    }
    const passwordHash = createHash('sha256').update(password).digest('hex');
    if (pool.passwordHash !== passwordHash) {
      return res.status(403).json({ error: 'Invalid password', code: 'INVALID_PASSWORD' });
    }
    const result = updatePool(poolId, req.body);
    res.json(result);
  } catch (error) {
    console.error(`Error updating pool ${req.params.id}:`, error);
    res.status(500).json({ error: error.message, code: error.code || 'UNKNOWN_ERROR' });
  }
});

// Endpoint to add whitelist addresses via JSON
app.post('/pool/:id/whitelist', (req, res) => {
  try {
    const poolId = req.params.id;
    const creatorAddress = req.query.creatorAddress;
    const password = req.query.password;
    const { addresses } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password required', code: 'MISSING_PASSWORD' });
    }
    if (!addresses || !Array.isArray(addresses)) {
      return res.status(400).json({ error: 'Invalid or missing addresses array', code: 'INVALID_ADDRESSES' });
    }
    const pools = loadPools();
    const pool = pools[poolId];
    if (!pool) {
      return res.status(404).json({ error: 'Pool not found', code: 'POOL_NOT_FOUND' });
    }
    if (pool.creatorAddress !== creatorAddress) {
      return res.status(403).json({ error: 'Unauthorized: You do not own this pool', code: 'UNAUTHORIZED' });
    }
    const passwordHash = createHash('sha256').update(password).digest('hex');
    if (pool.passwordHash !== passwordHash) {
      return res.status(403).json({ error: 'Invalid password', code: 'INVALID_PASSWORD' });
    }
    pool.whitelist = [...new Set([...pool.whitelist, ...addresses])]; // Avoid duplicates
    savePools(pools);
    res.json({ message: 'Whitelist updated successfully' });
  } catch (error) {
    console.error(`Error updating whitelist for pool ${req.params.id}:`, error);
    res.status(500).json({ error: error.message, code: error.code || 'UNKNOWN_ERROR' });
  }
});

// Endpoint to revoke access (remove wallet from whitelist)
app.post('/pool/:id/revoke', (req, res) => {
  try {
    const poolId = req.params.id;
    const creatorAddress = req.query.creatorAddress;
    const password = req.query.password;
    const { walletAddress } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password required', code: 'MISSING_PASSWORD' });
    }
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address required', code: 'MISSING_WALLET_ADDRESS' });
    }
    const pools = loadPools();
    const pool = pools[poolId];
    if (!pool) {
      return res.status(404).json({ error: 'Pool not found', code: 'POOL_NOT_FOUND' });
    }
    if (pool.creatorAddress !== creatorAddress) {
      return res.status(403).json({ error: 'Unauthorized: You do not own this pool', code: 'UNAUTHORIZED' });
    }
    const passwordHash = createHash('sha256').update(password).digest('hex');
    if (pool.passwordHash !== passwordHash) {
      return res.status(403).json({ error: 'Invalid password', code: 'INVALID_PASSWORD' });
    }
    pool.whitelist = pool.whitelist.filter(addr => addr !== walletAddress);
    if (pool.creditedWallets) {
      pool.creditedWallets = pool.creditedWallets.filter(addr => addr !== walletAddress);
    }
    savePools(pools);
    res.json({ message: 'Access revoked successfully' });
  } catch (error) {
    console.error(`Error revoking access for pool ${req.params.id}:`, error);
    res.status(500).json({ error: error.message, code: error.code || 'UNKNOWN_ERROR' });
  }
});

// Endpoint to create a new event pool
app.post('/create-pool', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password required for pool creation', code: 'MISSING_PASSWORD' });
    }
    const poolData = { ...req.body, passwordHash: createHash('sha256').update(password).digest('hex') };
    delete poolData.password; // Remove plain password from data
    const result = await createPool(poolData);
    res.json(result);
  } catch (error) {
    console.error('Pool creation error:', error);
    res.status(500).json({ error: error.message, code: error.code || 'UNKNOWN_ERROR' });
  }
});

// Endpoint to handle credit sharing
app.post('/share-credits', async (req, res) => {
  try {
    const result = await handleCreditSharing(req);
    res.json(result);
  } catch (error) {
    console.error('Credit sharing error:', error);
    res.status(500).json({ error: error.message, code: error.code || 'UNKNOWN_ERROR' });
  }
});

// Endpoint to get/set support link
app.route('/support-link')
  .get((req, res) => {
    try {
      const supportData = JSON.parse(readFileSync(SUPPORT_FILE, 'utf-8'));
      res.json({ link: supportData.link });
    } catch (error) {
      console.error('Error reading support link:', error);
      res.status(500).json({ error: error.message, code: 'SUPPORT_LINK_READ_FAILED' });
    }
  })
  .post((req, res) => {
    try {
      const { link } = req.body;
      if (!link || typeof link !== 'string') {
        return res.status(400).json({ error: 'Invalid or missing link', code: 'INVALID_LINK' });
      }
      writeFileSync(SUPPORT_FILE, JSON.stringify({ link }, null, 2));
      res.json({ message: 'Support link updated successfully' });
    } catch (error) {
      console.error('Error updating support link:', error);
      res.status(500).json({ error: error.message, code: 'SUPPORT_LINK_WRITE_FAILED' });
    }
  });

// Catch-all route
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
});

// Start the server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Sponsor server running on port ${PORT}`);
  console.log(`Pools file: ${POOLS_FILE}`);
}).on('error', (error) => {
  console.error(`Failed to start server on port ${PORT}:`, error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

export default app;