import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAILS_FILE = path.join(__dirname, 'emails.json');

// Load or initialize emails data
function loadEmails() {
  try {
    const emailsDir = path.dirname(EMAILS_FILE);
    if (!fs.existsSync(emailsDir)) {
      fs.mkdirSync(emailsDir, { recursive: true });
      console.log(`Created emails directory: ${emailsDir}`);
    }
    if (!fs.existsSync(EMAILS_FILE)) {
      fs.writeFileSync(EMAILS_FILE, JSON.stringify([], null, 2));
      console.log(`Created emails file: ${EMAILS_FILE}`);
    }
    return JSON.parse(fs.readFileSync(EMAILS_FILE, 'utf-8'));
  } catch (error) {
    console.error(`Error loading emails from ${EMAILS_FILE}:`, error);
    throw { code: 'LOAD_EMAILS_FAILED', message: `Failed to load emails: ${error.message}` };
  }
}

// Save emails data
function saveEmails(emails) {
  try {
    const emailsDir = path.dirname(EMAILS_FILE);
    if (!fs.existsSync(emailsDir)) {
      fs.mkdirSync(emailsDir, { recursive: true });
      console.log(`Created emails directory: ${emailsDir}`);
    }
    fs.writeFileSync(EMAILS_FILE, JSON.stringify(emails, null, 2));
    console.log(`Saved emails to: ${EMAILS_FILE}`);
  } catch (error) {
    console.error(`Error saving emails to ${EMAILS_FILE}:`, error);
    throw { code: 'SAVE_EMAILS_FAILED', message: `Failed to save emails: ${error.message}` };
  }
}

// Add a new email to the waitlist
async function addEmail(email) {
  const emails = loadEmails();

  // Check for duplicate email
  if (emails.includes(email)) {
    throw { code: 'EMAIL_EXISTS', message: 'Email already exists in waitlist' };
  }

  // Add email to list
  emails.push(email);
  saveEmails(emails);

  return { message: 'Successfully joined the waitlist' };
}

export { EMAILS_FILE, loadEmails, saveEmails, addEmail };