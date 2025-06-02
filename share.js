import { TurboFactory } from '@ardrive/turbo-sdk';
import { readFileSync, appendFileSync } from 'fs';

function isValidAddress(address) {
  return typeof address === 'string' && address.length > 0;
}

function isPositiveWinc(winc) {
  return /^(\d*\.\d+|\d+)$/.test(winc) && Number(winc) > 0;
}

async function shareCredits(keyfilePath, approvedAddress, approvedWincAmount, expiresBySeconds, revoke = false) {
  let keyfile;
  try {
    keyfile = JSON.parse(readFileSync(keyfilePath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to load keyfile: ${e.message}`);
  }

  if (!isValidAddress(approvedAddress)) {
    throw new Error('Invalid recipient address');
  }
  if (!revoke && !isPositiveWinc(approvedWincAmount)) {
    throw new Error('approvedWincAmount must be a positive number string');
  }
  if (!revoke && expiresBySeconds !== undefined && (!Number.isInteger(expiresBySeconds) || expiresBySeconds <= 0)) {
    throw new Error('expiresBySeconds must be a positive integer');
  }

  const turbo = TurboFactory.authenticated({ privateKey: keyfile });

  try {
    if (revoke) {
      const revokedApprovals = await turbo.revokeCredits({ revokedAddress: approvedAddress });
      console.log(JSON.stringify({ message: 'Revoked credit share approvals!', revokedApprovals }, null, 2));
      return { message: 'Credits revoked successfully' };
    } else {
      const wincInBigInt = BigInt(approvedWincAmount);
      const balanceResp = await turbo.getBalance();
      if (BigInt(balanceResp.winc) < wincInBigInt) {
        throw new Error(`Insufficient credits. Available: ${balanceResp.winc}, Required: ${wincInBigInt}`);
      }
      const approval = await turbo.shareCredits({
        approvedAddress,
        approvedWincAmount: wincInBigInt.toString(),
        expiresBySeconds,
      });
      console.log('✅ Credit share approval created:', approval);
      return { message: 'Credits shared successfully' };
    }
  } catch (err) {
    const errorDetails = {
      message: err.message || 'Unknown error',
      stack: err.stack || 'No stack trace',
      code: err.code || 'No code',
      response: err.response ? { status: err.response.status, data: err.response.data } : 'No response',
    };
    console.error(`❌ Failed to ${revoke ? 'revoke' : 'share'} credits:`, JSON.stringify(errorDetails, null, 2));
    appendFileSync('shareCredits-errors.log', `${new Date().toISOString()} ${JSON.stringify(errorDetails)}\n`);
    throw new Error(`Failed to ${revoke ? 'revoke' : 'share'} credits: ${err.message || 'Unknown error'}`);
  }
}

export { shareCredits };