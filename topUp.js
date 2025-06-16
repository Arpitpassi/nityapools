import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import Arweave from 'arweave';
import { TurboFactory, ArweaveSigner } from '@ardrive/turbo-sdk';
import { POOL_WALLETS_DIR, getPoolById, loadPools, savePools } from './poolManager.js';
import { loadWalletFromPath } from './walletManager.js';

const arweave = Arweave.init({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
});

async function handleTopUp(poolId, password, amount, creatorAddress) {
  try {
    // Validate inputs
    if (!poolId || !password || !amount || !creatorAddress) {
      throw { code: 'MISSING_PARAMETERS', message: 'Missing required parameters' };
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      throw { code: 'INVALID_AMOUNT', message: 'Amount must be a positive number' };
    }

    // Fetch pool data
    const pool = getPoolById(poolId);
    if (!pool) {
      throw { code: 'POOL_NOT_FOUND', message: 'Pool not found' };
    }

    // Verify creator address
    if (pool.creatorAddress !== creatorAddress) {
      throw { code: 'UNAUTHORIZED', message: 'Unauthorized creator address' };
    }

    // Verify password
    const passwordHash = createHash('sha256').update(password).digest('hex');
    if (pool.passwordHash !== passwordHash) {
      throw { code: 'INVALID_PASSWORD', message: 'Invalid password' };
    }

    // Load pool wallet
    const wallet = loadWalletFromPath(pool.walletPath);

    // Get pool wallet address
    const poolWalletAddress = await arweave.wallets.jwkToAddress(wallet);

    // Check current AR balance
    const balance = await arweave.wallets.getBalance(poolWalletAddress);
    const arBalance = arweave.ar.winstonToAr(balance);
    const arBalanceNum = parseFloat(arBalance);
    console.log(`Current AR balance for pool ${poolId}: ${arBalance} AR`);

    if (arBalanceNum < parsedAmount) {
      throw { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient AR balance in pool wallet' };
    }

    // Convert amount to Winston for Turbo top-up
    const winstonAmount = arweave.ar.arToWinston(parsedAmount.toString());

    // Set up Turbo client and perform top-up
    const signer = new ArweaveSigner(wallet);
    const turbo = TurboFactory.authenticated({ signer, token: 'arweave' });
    const topUpResult = await turbo.topUpWithTokens({ tokenAmount: winstonAmount });
    console.log(`Successfully topped up pool ${poolId} with ${parsedAmount} AR worth of Turbo credits`);

    // Update pool metadata (optional: track top-up history)
    const pools = loadPools();
    pools[poolId].topUpHistory = pools[poolId].topUpHistory || [];
    pools[poolId].topUpHistory.push({
      amount: parsedAmount,
      timestamp: new Date().toISOString(),
    });
    savePools(pools);

    return { success: true, message: 'Top-up successful', result: topUpResult };
  } catch (error) {
    console.error(`Top-up error for pool ${poolId}:`, error);
    throw {
      code: error.code || 'TOP_UP_FAILED',
      message: error.message || 'Failed to process top-up',
    };
  }
}

export default { handleTopUp };