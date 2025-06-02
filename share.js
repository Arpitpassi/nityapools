import { TurboFactory } from '@ardrive/turbo-sdk';
import { readFileSync, appendFileSync } from 'fs';

function isValidAddress(address) {
  // Replace this with actual Turbo/Arweave address regex validation as needed
  return typeof address === 'string' && address.length > 0;
}

function isPositiveWinc(winc) {
  // Allow decimal numbers for Winston amounts
  return /^(\d*\.\d+|\d+)$/.test(winc) && Number(winc) > 0;
}

async function shareCredits(keyfilePath, approvedAddress, approvedWincAmount, expiresBySeconds) {
  let keyfile;
  try {
    keyfile = JSON.parse(readFileSync(keyfilePath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to load keyfile: ${e.message}`);
  }

  if (!isValidAddress(approvedAddress)) {
    throw new Error('Invalid recipient address');
  }
  if (!isPositiveWinc(approvedWincAmount)) {
    throw new Error('approvedWincAmount must be a positive number string');
  }
  if (expiresBySeconds !== undefined && (!Number.isInteger(expiresBySeconds) || expiresBySeconds <= 0)) {
    throw new Error('expiresBySeconds must be a positive integer');
  }

  const turbo = TurboFactory.authenticated({ privateKey: keyfile });

  // Convert approvedWincAmount to Winston (1 AR = 1e12 Winston)
  const wincInBigInt = approvedWincAmount;

  // Check available balance
  try {
    const userAddress = turbo.signer.address;
    const balanceResp = await turbo.getBalance(userAddress);
    if (BigInt(balanceResp.winc) < wincInBigInt) {
      throw new Error(`Insufficient credits. Available: ${balanceResp.winc}, Required: ${wincInBigInt}`);
    }
  } catch (e) {
    throw new Error(`Could not check balance: ${e.message}`);
  }
  console.log(expiresBySeconds);  
  try {
    const approval = await turbo.shareCredits({
      approvedAddress,
      approvedWincAmount: wincInBigInt.toString(),
      expiresBySeconds,
    });
    console.log('✅ Credit share approval created:', approval);
    return { message: 'Credits shared successfully' };
  } catch (err) {
    console.error('❌ Failed to share credits:', err.message || err);
    appendFileSync('shareCredits-errors.log', `${new Date().toISOString()} ${err.stack || err}\n`);
    return { message: 'Failed to share credits', error: err.message || err };
  }
}

export { shareCredits };