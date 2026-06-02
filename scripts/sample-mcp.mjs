/**
 * scripts/sample-mcp.mjs — reference paid MCP server, deployed to the VPS.
 *
 * Lives downstream of the Vercel gateway. Returns the standard `-32402`
 * envelope; the gateway rewrites payTo → X402FeeSplitFacilitator and routes
 * settlement on Base Sepolia.
 *
 * SOLID:
 *   - Single Responsibility: defines paid tools + listens. No proxy logic,
 *     no fee logic, no auth — gateway owns those.
 *   - Open-Closed: add a tool = one paidTool({...}) entry; no other edits.
 */
import { createPaidMcpServer, paidTool } from 'n-payment/mcp';

const PORT = Number(process.env.PORT ?? 3000);

// Publisher payout address. Gateway's envelope rewrite overrides this with
// `extra.publisherPayTo` from the buyer's session, so the value here is only
// what an unmediated caller would see. Default = the demo deployer's address.
const PAY_TO =
  process.env.PUBLISHER_ADDRESS ?? '0x100690a32B562fd45e685BC2E63bbfF566d452db';

const server = createPaidMcpServer({
  name: 'NimClaw Weather',
  description: 'Reference paid MCP server for the n-payment portal demo.',
  payTo: PAY_TO,
  chain: 'base-sepolia',
  tools: [
    paidTool({
      name: 'forecast',
      description: 'Get the current forecast for a city',
      price: 10000n, // $0.01 USDC (6-decimal base units)
      handler: async ({ city }) => ({
        city: typeof city === 'string' ? city : 'unknown',
        tempC: 22,
        forecast: 'sunny',
        ts: new Date().toISOString(),
      }),
    }),
  ],
});

await server.listen(PORT);
// eslint-disable-next-line no-console
console.log(JSON.stringify({ msg: 'sample-mcp.listening', port: PORT, payTo: PAY_TO }));
