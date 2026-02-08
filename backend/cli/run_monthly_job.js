/**
 * One-shot entrypoint for running the monthly report as a Cloud Run Job.
 * Does not start the Express server. Exits with 0 on success, 1 on failure.
 */

import { runMonthly } from '../jobs/monthly.js';

async function main() {
  console.log('[job] monthly started');

  const refresh = process.env.REFRESH === '1';
  const now = process.env.NOW_ISO ? new Date(process.env.NOW_ISO) : undefined;

  const opts = { refresh };
  if (now !== undefined) opts.now = now;

  try {
    await runMonthly(opts);
    console.log('[job] monthly finished');
    process.exit(0);
  } catch (err) {
    console.error('[job] monthly failed', err);
    process.exit(1);
  }
}

main();
