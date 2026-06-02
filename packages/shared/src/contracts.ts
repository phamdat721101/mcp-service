/**
 * Contract addresses + minimal ABIs.
 *
 * Addresses are the zero address until Task 9 (deploy) lands. The deploy
 * scripts in `packages/contracts/script/Deploy.s.sol` write to this file.
 */
import type { ChainKey } from './chains.js';

export type Address = `0x${string}`;
const ZERO: Address = '0x0000000000000000000000000000000000000000';

export interface ContractDeployment {
  /** X402FeeSplitFacilitator (or Forwarder variant on Flare). */
  feeSplit: Address;
  /** Treasury fee receiver wallet (controlled by Gateway). */
  feeReceiver: Address;
  /** ERC-8004 Identity Registry — set on chains where ERC-8004 is canonical. */
  erc8004Identity: Address;
  /** ERC-8004 Reputation Registry. */
  erc8004Reputation: Address;
}

export const CONTRACTS: Readonly<Record<ChainKey, ContractDeployment>> = Object.freeze({
  'base-mainnet': { feeSplit: ZERO, feeReceiver: ZERO, erc8004Identity: ZERO, erc8004Reputation: ZERO },
  'base-sepolia': {
    // Deployed 2026-06-01, tx 0x3aa70c6a…d28f127c
    feeSplit: '0x02f497ea02b2C1B525F107EbA3099728D235A544',
    // Testnet: deployer doubles as fee receiver until KMS-backed production wallet lands.
    feeReceiver: '0x100690a32B562fd45e685BC2E63bbfF566d452db',
    erc8004Identity: ZERO,
    erc8004Reputation: ZERO,
  },
  'morph-hoodi-testnet': {
    feeSplit: ZERO,
    feeReceiver: ZERO,
    erc8004Identity: ZERO,
    erc8004Reputation: ZERO,
  },
  'flare-coston2-testnet': {
    feeSplit: ZERO,
    feeReceiver: ZERO,
    erc8004Identity: ZERO,
    erc8004Reputation: ZERO,
  },
  'goat-testnet3': {
    feeSplit: ZERO,
    feeReceiver: ZERO,
    // GOAT publishes ERC-8004 registries publicly; placeholder until wired in Task 7.
    erc8004Identity: '0x556089008Fc0a60cD09390Eca93477ca254A5522',
    erc8004Reputation: '0xd9140951d8aE6E5F625a02F5908535e16e3af964',
  },
  'goat-mainnet': {
    feeSplit: ZERO,
    feeReceiver: ZERO,
    erc8004Identity: ZERO,
    erc8004Reputation: ZERO,
  },
});

/** Minimal ABI for X402FeeSplitFacilitator.settle(...). */
export const FEE_SPLIT_ABI = [
  {
    type: 'function',
    name: 'settle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'from', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
      { name: 'publisherPayTo', type: 'address' },
      { name: 'feeBps', type: 'uint16' },
      { name: 'feeReceiver', type: 'address' },
      { name: 'paymentId', type: 'bytes32' },
    ],
    outputs: [{ name: 'fee', type: 'uint256' }, { name: 'publisherAmount', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Settled',
    inputs: [
      { name: 'paymentId', type: 'bytes32', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'publisher', type: 'address', indexed: false },
      { name: 'feeReceiver', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
] as const;
