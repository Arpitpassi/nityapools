import express, { json } from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import cors from 'cors';
import { createHash } from 'crypto';
import { POOL_WALLETS_DIR, POOLS_FILE, loadPools, savePools, getPoolBalance, updatePool, createPool } from './poolManager.js';
import { handleCreditSharing } from './creditSharing.js';
import { handleCreditRevocation } from './creditSharing.js';
import fs from 'fs';
import path from 'path';

const app = express();

// Define paths
const EMAILS_FILE = path.join(path.dirname(POOLS_FILE), 'emails.json');

// Enable CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Event-Pool-Id']
}));
app.use(json());

// Ensure pool_wallets directory exists
if (!existsSync(POOL_WALLETS_DIR)) {
  mkdirSync(POOL_WALLETS_DIR, { recursive: true });
  console.log(`Created pool wallets directory: ${POOL_WALLETS_DIR}`);
}

// Ensure emails.json exists
if (!existsSync(EMAILS_FILE)) {
  writeFileSync(EMAILS_FILE, JSON.stringify({ emails: [] }, null, 2));
  console.log(`Created emails file: ${EMAILS_FILE}`);
}

// Log directory paths at startup
console.log(`POOLS_FILE: ${POOLS_FILE}`);
console.log(`POOL_WALLETS_DIR: ${POOL_WALLETS_DIR}`);
console.log(`EMAILS_FILE: ${EMAILS_FILE}`);

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
    'X-API-Key': apiKey || 'none',
    'X-Event-Pool-Id': req.header('X-Event-Pool-Id') || 'none',
    'Content-Type': req.header('Content-Type') || 'none'
  });

  if (path === '/health' || path === '/pools' || path === '/support-link' || path === '/api/waitlist' || path === '/api/check-waitlist') {
    console.log(`[${new Date().toISOString()}] Bypassing API key check for ${path}`);
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

app.post('/pool/:id/revoke', async (req, res) => {
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

    // Revoke credits via Turbo SDK
    const revocationResult = await handleCreditRevocation({
      body: { eventPoolId: poolId, walletAddress }
    });

    if (revocationResult.message === 'Credits revoked successfully') {
      pool.whitelist = pool.whitelist.filter(addr => addr !== walletAddress);
      if (pool.creditedWallets) {
        pool.creditedWallets = pool.creditedWallets.filter(addr => addr !== walletAddress);
      }
      savePools(pools);
      res.json({ message: 'Access revoked successfully' });
    } else {
      throw new Error('Revocation failed');
    }
  } catch (error) {
    console.error(`Error revoking access for pool ${req.params.id}:`, error);
    res.status(500).json({ error: error.message, code: error.code || 'UNKNOWN_ERROR' });
  }
});

// Endpoint to delete a pool
app.delete('/pool/:id', (req, res) => {
  try {
    const poolId = req.params.id;
    const { password, creatorAddress } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password required', code: 'MISSING_PASSWORD' });
    }
    if (!creatorAddress) {
      return res.status(400).json({ error: 'Creator address required', code: 'MISSING_CREATOR_ADDRESS' });
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

    // Delete the wallet file
    if (fs.existsSync(pool.walletPath)) {
      fs.unlinkSync(pool.walletPath);
      console.log(`Deleted wallet file for pool ${poolId}: ${pool.walletPath}`);
    }

    // Remove the pool from pools.json
    delete pools[poolId];
    savePools(pools);

    console.log(`[${new Date().toISOString()}] Pool ${poolId} deleted by creator ${creatorAddress}`);
    res.json({ message: 'Pool deleted successfully' });
  } catch (error) {
    console.error(`Error deleting pool ${req.params.id}:`, error);
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

// Endpoint to handle waitlist email submission
app.post('/api/waitlist', (req, res) => {
  console.log(`[${new Date().toISOString()}] Received waitlist request with body:`, req.body);
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.log(`[${new Date().toISOString()}] Invalid email: ${email}`);
      return res.status(400).json({ error: 'Invalid email address', code: 'INVALID_EMAIL' });
    }

    let emailsData = { emails: [] };
    if (existsSync(EMAILS_FILE)) {
      try {
        emailsData = JSON.parse(readFileSync(EMAILS_FILE, 'utf-8'));
      } catch (parseError) {
        console.error(`[${new Date().toISOString()}] Error parsing emails.json:`, parseError);
        return res.status(500).json({ error: 'Failed to process waitlist', code: 'FILE_PARSE_ERROR' });
      }
    }

    if (emailsData.emails.includes(email)) {
      console.log(`[${new Date().toISOString()}] Email already in waitlist: ${email}`);
      return res.status(400).json({ error: 'Email already in waitlist', code: 'EMAIL_EXISTS' });
    }

    emailsData.emails.push(email);
    try {
      writeFileSync(EMAILS_FILE, JSON.stringify(emailsData, null, 2));
      console.log(`[${new Date().toISOString()}] Added email to waitlist: ${email}`);
      res.json({ message: 'Successfully joined waitlist' });
    } catch (writeError) {
      console.error(`[${new Date().toISOString()}] Error writing to emails.json:`, writeError);
      return res.status(500).json({ error: 'Failed to save email', code: 'FILE_WRITE_ERROR' });
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error processing waitlist request:`, error);
    res.status(500).json({ error: 'Failed to join waitlist', code: 'WAITLIST_ERROR' });
  }
});

// Endpoint to check waitlist status
app.post('/api/check-waitlist', (req, res) => {
  console.log(`[${new Date().toISOString()}] Received check-waitlist request with body:`, req.body);
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.log(`[${new Date().toISOString()}] Invalid email: ${email}`);
      return res.status(400).json({ error: 'Invalid email address', code: 'INVALID_EMAIL' });
    }

    let emailsData = { emails: [] };
    if (existsSync(EMAILS_FILE)) {
      try {
        emailsData = JSON.parse(readFileSync(EMAILS_FILE, 'utf-8'));
      } catch (parseError) {
        console.error(`[${new Date().toISOString()}] Error parsing emails.json:`, parseError);
        return res.status(500).json({ error: 'Failed to check waitlist status', code: 'FILE_PARSE_ERROR' });
      }
    }

    const isInWaitlist = emailsData.emails.includes(email);
    console.log(`[${new Date().toISOString()}] Checked waitlist status for ${email}: ${isInWaitlist}`);
    res.json({ isInWaitlist });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error checking waitlist status:`, error);
    res.status(500).json({ error: 'Failed to check waitlist status', code: 'CHECK_WAITLIST_ERROR' });
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
  console.log(`Emails file: ${EMAILS_FILE}`);
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