import fs from 'node:fs';
import path from 'node:path';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';

dotenv.config();

const rootDirectory = path.resolve(import.meta.dirname, '..');

const loadServiceAccount = () => {
  const serialized = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serialized) {
    try {
      return JSON.parse(serialized);
    } catch (error) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON: ${error.message}`,
      );
    }
  }

  const keyFile = fs
    .readdirSync(rootDirectory)
    .find(
      (filename) =>
        filename.startsWith('portfolio-universe-firebase-adminsdk-') &&
        filename.endsWith('.json'),
    );
  if (!keyFile) return null;

  return JSON.parse(
    fs.readFileSync(path.join(rootDirectory, keyFile), 'utf8'),
  );
};

export const getAdminFirestore = () => {
  if (getApps().length === 0) {
    const serviceAccount = loadServiceAccount();
    if (serviceAccount?.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(
        /\\n/g,
        '\n',
      );
    }
    initializeApp({
      credential: serviceAccount
        ? cert(serviceAccount)
        : applicationDefault(),
      projectId: 'portfolio-universe',
    });
  }
  return getFirestore();
};
