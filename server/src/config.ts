import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Scan potential locations for the .env file
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), '../.env'),
  path.join(__dirname, '.env'),
  path.join(__dirname, '../.env'),
  path.join(__dirname, '../../.env'),
  path.join(__dirname, '../../../.env'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}
