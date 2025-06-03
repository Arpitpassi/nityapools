/**
 * Standalone script to test Turbo SDK credit revocation.
 * Specify the path to your wallet JWK file and the address to revoke credits for.
 */
import { TurboFactory, ArweaveSigner } from '@ardrive/turbo-sdk';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// Configuration
const WALLET_PATH = '/home/arpit/.nitya/sponsor/pool_wallets/e79662cc91b1d88309af4626fcbb17d5.json'; // Replace with your wallet JWK file path
const REVOKE_ADDRESS = 'afxI6WkgOuP9c9HbTfTCJp20lXwI3s6nOSmCXae_C0g'; // Replace with the address to revoke credits for

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Function to prompt user for input
function prompt(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

// Function to load wallet
function loadWallet(walletPath) {
  try {
    const walletJwk = JSON.parse(fs.readFileSync(path.resolve(walletPath), 'utf8'));
    return walletJwk;
  } catch (error) {
    throw new Error(`Failed to load wallet: ${error.message}`);
  }
}

// Function to check wallet balance
async function checkBalance(turbo, address) {
  try {
    const balanceResp = await turbo.getBalance();
    console.log(`Balance for ${address}:`, balanceResp);
    return balanceResp;
  } catch (error) {
    console.error(`Balance Check Error for ${address}:`, error.message);
    return null;
  }
}

// Function to revoke credits
async function revokeCredits(walletJwk, revokedAddress) {
  try {
    const signer = new ArweaveSigner(walletJwk);
    const turbo = TurboFactory.authenticated({ signer, token: 'arweave' });

    console.log(`Attempting to revoke credits for address: ${revokedAddress}`);
    const revokedApprovals = await turbo.revokeCredits({ revokedAddress });
    console.log(JSON.stringify({ message: 'Revoked credit share approvals!', revokedApprovals }, null, 2));
    return { success: true, message: 'Credits revoked successfully' };
  } catch (error) {
    const errorDetails = {
      message: error.message || 'Unknown error',
      stack: error.stack || 'No stack trace',
      code: error.code || 'No code',
      response: error.response ? { status: error.response.status, data: error.response.data } : 'No response',
    };
    console.error('Revocation Error:', JSON.stringify(errorDetails, null, 2));
    fs.appendFileSync('revocation-errors.log', `${new Date().toISOString()} ${JSON.stringify(errorDetails)}\n`);
    return { success: false, message: error.message };
  }
}

// Main test function
async function runTest() {
  console.log('Starting Turbo SDK Revocation Test...');

  // Prompt for wallet path if not set
  let walletPath = WALLET_PATH;
  if (!walletPath || walletPath === './path/to/your/wallet.json') {
    walletPath = await prompt('Enter the path to your wallet JWK file: ');
  }

  // Prompt for revoke address if not set
  let revokeAddress = REVOKE_ADDRESS;
  if (!revokeAddress || revokeAddress === 'afxI6WkgOuP9c9HbTfTCJp20lXwI3s6nOSmCXae_C0g') {
    revokeAddress = await prompt('Enter the wallet address to revoke credits for: ');
  }

  // Load wallet
  let walletJwk;
  try {
    walletJwk = loadWallet(walletPath);
    console.log('Wallet loaded successfully');
  } catch (error) {
    console.error(error.message);
    rl.close();
    return;
  }

  // Initialize Turbo client
  const signer = new ArweaveSigner(walletJwk);
  const turbo = TurboFactory.authenticated({ signer, token: 'arweave' });

  // Check wallet balance before revocation
  console.log('Checking wallet balance before revocation...');
  await checkBalance(turbo, revokeAddress);

  // Attempt revocation
  console.log('Attempting credit revocation...');
  const result = await revokeCredits(walletJwk, revokeAddress);
  if (!result.success) {
    console.error('Revocation failed:', result.message);
    rl.close();
    return;
  }

  // Check wallet balance after revocation
  console.log('Checking wallet balance after revocation...');
  await checkBalance(turbo, revokeAddress);

  // Attempt a test deployment to confirm revocation
  console.log('Attempting test deployment with revoked wallet...');
  try {
    const testData = Buffer.from('Test data for deployment');
    const uploadResponse = await turbo.uploadFile({
      fileStreamFactory: () => testData,
      fileSizeFactory: () => testData.length,
      dataItemOpts: { tags: [{ name: 'Test', value: 'Revocation' }] },
    });
    console.error('Test Failed: Deployment succeeded with revoked wallet:', uploadResponse);
  } catch (error) {
    console.log('Test Passed: Deployment failed as expected:', error.message);
  }

  rl.close();
}

runTest().catch(error => {
  console.error('Test Error:', error);
  rl.close();
});