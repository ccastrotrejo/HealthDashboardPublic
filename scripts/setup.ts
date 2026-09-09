#!/usr/bin/env tsx
import { setupLocal } from './lib/setup.js';

const created = setupLocal();
console.error(created.length ? `Created: ${created.join(', ')}` : 'Local setup already exists; nothing overwritten.');
console.error('Fill in provider credentials in .env.local, then run pnpm auth whoop, pnpm auth strava, or pnpm auth garmin.');
console.error('Customize private/athlete.json, then run pnpm sync and pnpm dev.');
