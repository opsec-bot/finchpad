import { logsClient } from "./chain.js";

/**
 * Fetch logs in bounded block chunks. The public Robinhood RPC times out on wide
 * eth_getLogs ranges, so we walk the range in windows and shrink the window on
 * failure before giving up.
 *
 * @param {object} opts
 * @param {`0x${string}`} opts.address        contract to read logs from
 * @param {object}       opts.event           parsed ABI event item
 * @param {bigint}       opts.fromBlock
 * @param {bigint}       opts.toBlock
 * @param {bigint}       [opts.chunkSize=2000n]
 * @param {(info:{from:bigint,to:bigint,found:number,total:number})=>void} [opts.onProgress]
 */
export async function getLogsChunked({
  address,
  event,
  fromBlock,
  toBlock,
  chunkSize = 2000n,
  onProgress,
}) {
  const out = [];
  let from = fromBlock;

  while (from <= toBlock) {
    let span = chunkSize;
    let logs = null;

    // Retry the current window with a shrinking span before failing hard.
    for (let attempt = 0; attempt < 5; attempt++) {
      const to = from + span - 1n > toBlock ? toBlock : from + span - 1n;
      try {
        logs = await logsClient.getLogs({ address, event, fromBlock: from, toBlock: to });
        from = to + 1n;
        break;
      } catch (err) {
        span = span / 2n;
        if (span < 1n || attempt === 4) {
          throw new Error(
            `getLogs failed at block ${from} (span shrank to ${span}): ${err.shortMessage || err.message}`
          );
        }
      }
    }

    if (logs) {
      out.push(...logs);
      if (onProgress) {
        onProgress({ from, to: toBlock, found: logs.length, total: out.length });
      }
    }
  }

  return out;
}
