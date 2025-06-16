import { loadPools, savePools } from './poolManager.js';
import { loadWalletFromPath } from './walletManager.js';
import { TurboFactory, ArweaveSigner } from '@ardrive/turbo-sdk';
import { shareCredits } from './share.js';
import Arweave from 'arweave';

async function handleCreditSharing(req) {
  const { eventPoolId, walletAddress } = req.body;
  console.log(`Handling credit sharing for pool: ${eventPoolId}, wallet: ${walletAddress}`);

  // Validate inputs
  if (!eventPoolId) {
    throw { code: 'MISSING_POOL_ID', message: 'Event pool ID is required' };
  }
  if (!walletAddress) {
    throw { code: 'MISSING_WALLET_ADDRESS', message: 'Wallet address is required' };
  }

  // Load and validate event pool
  const pools = loadPools();
  const pool = pools[eventPoolId];
  if (!pool) {
    throw { code: 'POOL_NOT_FOUND', message: 'Pool not found' };
  }

  // Derive creatorAddress from pool wallet
  const arweave = Arweave.init({});
  let creatorAddress;
  try {
    const poolWallet = loadWalletFromPath(pool.walletPath);
    creatorAddress = await arweave.wallets.jwkToAddress(poolWallet);
    console.log(`Derived creatorAddress: ${creatorAddress}`);
  } catch (error) {
    throw { code: 'WALLET_ERROR', message: `Failed to derive creator address: ${error.message}` };
  }

  // Check if pool is active
  const now = new Date().toISOString();
  if (now < pool.startTime || now > pool.endTime) {
    throw { code: 'POOL_NOT_ACTIVE', message: 'Pool is not active' };
  }

  // Check if wallet is in whitelist
  if (!pool.whitelist.includes(walletAddress)) {
    throw { code: 'WALLET_NOT_WHITELISTED', message: 'Wallet address not in whitelist' };
  }

  // Check if wallet has already received credits
  if (pool.creditedWallets && pool.creditedWallets.includes(walletAddress)) {
    throw { code: 'ALREADY_CREDITED', message: 'Wallet has already received credits for this pool' };
  }

  // Create authenticated Turbo client
  const poolWallet = loadWalletFromPath(pool.walletPath);
  const signer = new ArweaveSigner(poolWallet);
  const turbo = TurboFactory.authenticated({ signer, token: 'arweave' });

  // Calculate time left in seconds from current time to end time
  const endTime = new Date(pool.endTime);
  const currentTime = new Date();

  // Validate dates
  if (isNaN(endTime.getTime()) || isNaN(currentTime.getTime())) {
    throw { code: 'INVALID_DATE', message: 'Invalid date provided' };
  }

  // Calculate seconds until end time
  const secondsUntilEnd = Math.floor((endTime - currentTime) / 1000);
  if (secondsUntilEnd <= 0) {
    throw { code: 'POOL_ENDED', message: 'Pool has already ended' };
  }
  console.log(`Seconds until pool end: ${secondsUntilEnd}`);

  // Convert usageCap from Turbo credits to Winston
  const usageCap = pool.usageCap; // in Turbo credits
  console.log(`Usage cap in Turbo credits: ${usageCap}`);
  const approvedWincAmount = BigInt(Math.round(usageCap * 1e12)); // in Winston
  console.log(approvedWincAmount);

  const results = await shareCredits(
    pool.walletPath,
    walletAddress,
    approvedWincAmount.toString(),
    secondsUntilEnd
  );

  // If credits are shared successfully, update the pool data
  if (results.message === 'Credits shared successfully') {
    if (!pool.creditedWallets) {
      pool.creditedWallets = [];
    }
    pool.creditedWallets.push(walletAddress);
    savePools(pools);
  }

  return results;
}

async function handleCreditRevocation(req) {
  const { eventPoolId, walletAddress } = req.body;
  console.log(`Handling credit revocation for pool: ${eventPoolId}, wallet: ${walletAddress}`);

  // Validate inputs
  if (!eventPoolId) {
    throw { code: 'MISSING_POOL_ID', message: 'Event pool ID is required' };
  }
  if (!walletAddress) {
    throw { code: 'MISSING_WALLET_ADDRESS', message: 'Wallet address is required' };
  }

  // Load and validate event pool
  const pools = loadPools();
  const pool = pools[eventPoolId];
  if (!pool) {
    throw { code: 'POOL_NOT_FOUND', message: 'Pool not found' };
  }

  // Derive creatorAddress from pool wallet
  const arweave = Arweave.init({});
  let creatorAddress;
  try {
    const poolWallet = loadWalletFromPath(pool.walletPath);
    creatorAddress = await arweave.wallets.jwkToAddress(poolWallet);
    console.log(`Derived creatorAddress: ${creatorAddress}`);
  } catch (error) {
    throw { code: 'WALLET_ERROR', message: `Failed to derive creator address: ${error.message}` };
  }

  // Check if wallet has received credits
  if (!pool.creditedWallets || !pool.creditedWallets.includes(walletAddress)) {
    throw { code: 'NOT_CREDITED', message: 'Wallet has not received credits for this pool' };
  }

  // Create authenticated Turbo client
  const poolWallet = loadWalletFromPath(pool.walletPath);
  const signer = new ArweaveSigner(poolWallet);
  const turbo = TurboFactory.authenticated({ signer, token: 'arweave' });

  // Revoke credits
  try {
    const results = await shareCredits(pool.walletPath, walletAddress, '0', undefined, true);
    if (results.message === 'Credits revoked successfully') {
      pool.creditedWallets = pool.creditedWallets.filter(addr => addr !== walletAddress);
      savePools(pools);
    }
    return results;
  } catch (error) {
    throw { code: 'REVOCATION_FAILED', message: `Failed to revoke credits: ${error.message}` };
  }
}

export { handleCreditSharing, handleCreditRevocation };