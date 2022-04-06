import { BridgeId } from '../aztec/bridge_id';
import { AddressZero } from '@ethersproject/constants';

import { AssetValue, AsyncYieldBridgeData, AuxDataConfig, AztecAsset, SolidityType } from '../bridge-data';
import { ElementBridge, RollupProcessor, IVault } from '../../../typechain-types';

export type BatchSwapStep = {
  poolId: string;
  assetInIndex: number;
  assetOutIndex: number;
  amount: string;
  userData: string;
};

export enum SwapType {
  SwapExactIn,
  SwapExactOut,
}

export type FundManagement = {
  sender: string;
  recipient: string;
  fromInternalBalance: boolean;
  toInternalBalance: boolean;
};

function divide(a: bigint, b: bigint, precision: bigint) {
  return (a * precision) / b;
}

export class ElementBridgeData implements AsyncYieldBridgeData {
  private elementBridgeContract: ElementBridge;
  private rollupContract: RollupProcessor;
  private balancerContract: IVault;
  public scalingFactor = BigInt(1n * 10n ** 18n);

  constructor(elementBridge: ElementBridge, balancer: IVault, rollupContract: RollupProcessor) {
    this.elementBridgeContract = elementBridge;
    this.rollupContract = rollupContract;
    this.balancerContract = balancer;
  }

  // @dev This function should be implemented for stateful bridges. It should return an array of AssetValue's
  // @dev which define how much a given interaction is worth in terms of Aztec asset ids.
  // @param bigint interactionNonce the interaction nonce to return the value for

  async getInteractionPresentValue(interactionNonce: bigint): Promise<AssetValue[]> {
    const interaction = await this.elementBridgeContract.interactions(interactionNonce);
    const exitTimestamp = interaction.expiry;
    const endValue = interaction.quantityPT;

    // we get the present value of the interaction
    const blockNumber = await this.rollupContract.getDefiInteractionBlockNumber(interactionNonce);
    const [rollupInteraction] = await this.rollupContract.queryFilter(
      this.rollupContract.filters.AsyncDefiBridgeProcessed(undefined, interactionNonce),
      blockNumber.toNumber(),
      blockNumber.toNumber(),
    );
    const { timestamp: entryTimestamp } = await rollupInteraction.getBlock();
    const {
      args: [bridgeId, , totalInputValue],
    } = rollupInteraction;

    const now = Math.floor(Date.now() / 1000);
    const totalInterest = endValue.toBigInt() - totalInputValue.toBigInt();
    const elapsedTime = BigInt(now - entryTimestamp);
    const totalTime = exitTimestamp.toBigInt() - BigInt(entryTimestamp);
    const timeRatio = divide(elapsedTime, totalTime, this.scalingFactor);
    const accruedInterst = (totalInterest * timeRatio) / this.scalingFactor;

    return [
      {
        assetId: BigInt(BridgeId.fromBigInt(bridgeId.toBigInt()).inputAssetId),
        amount: totalInputValue.toBigInt() + accruedInterst,
      },
    ];
  }

  async getAuxData(
    inputAssetA: AztecAsset,
    inputAssetB: AztecAsset,
    outputAssetA: AztecAsset,
    outputAssetB: AztecAsset,
  ): Promise<bigint[]> {
    return (await this.elementBridgeContract.getAssetExpiries(inputAssetA.erc20Address)).map(a => a.toBigInt());
  }

  public auxDataConfig: AuxDataConfig[] = [
    {
      start: 0,
      length: 64,
      solidityType: SolidityType.uint64,
      description: 'Unix Timestamp of the tranch expiry',
    },
  ];

  async getExpectedOutput(
    inputAssetA: AztecAsset,
    inputAssetB: AztecAsset,
    outputAssetA: AztecAsset,
    outputAssetB: AztecAsset,
    auxData: bigint,
    precision: bigint,
  ): Promise<bigint[]> {
    // bridge is async the third parameter represents this
    return [BigInt(0), BigInt(0), BigInt(1)];
  }

  async getExpectedYearlyOuput(
    inputAssetA: AztecAsset,
    inputAssetB: AztecAsset,
    outputAssetA: AztecAsset,
    outputAssetB: AztecAsset,
    auxData: bigint,
    precision: bigint,
  ): Promise<bigint[]> {
    const assetExpiryHash = await this.elementBridgeContract.hashAssetAndExpiry(inputAssetA.erc20Address, auxData);
    const pool = await this.elementBridgeContract.pools(assetExpiryHash);
    const poolId = pool.poolId;
    const trancheAddress = pool.trancheAddress;

    const funds: FundManagement = {
      sender: AddressZero,
      recipient: AddressZero,
      fromInternalBalance: false,
      toInternalBalance: false,
    };

    const step: BatchSwapStep = {
      poolId,
      assetInIndex: 0,
      assetOutIndex: 1,
      amount: precision.toString(),
      userData: '0x',
    };

    const deltas = await this.balancerContract.queryBatchSwap(
      SwapType.SwapExactIn,
      [step],
      [inputAssetA.erc20Address, trancheAddress],
      funds,
    );

    const outputAssetAValue = deltas[1];

    const timeToExpiration = auxData - BigInt(Math.floor(Date.now() / 1000));

    const YEAR = 60n * 60n * 24n * 365n;
    const interest = -outputAssetAValue.toBigInt() - precision;
    const scaledOutput = divide(interest, timeToExpiration, this.scalingFactor);
    const yearlyOutput = (scaledOutput * YEAR) / this.scalingFactor;

    return [yearlyOutput + precision, BigInt(0)];
  }

  async getMarketSize(
    inputAssetA: AztecAsset,
    inputAssetB: AztecAsset,
    outputAssetA: AztecAsset,
    outputAssetB: AztecAsset,
    auxData: bigint,
  ): Promise<AssetValue[]> {
    const assetExpiryHash = await this.elementBridgeContract.hashAssetAndExpiry(inputAssetA.erc20Address, auxData);
    const pool = await this.elementBridgeContract.pools(assetExpiryHash);
    const poolId = pool.poolId;
    const tokenBalances = await this.balancerContract.getPoolTokens(poolId);

    // todo return the correct aztec assetIds
    return tokenBalances[0].map((address, index) => {
      return {
        assetId: BigInt(address), // todo fetch via the sdk @Leila
        amount: tokenBalances[1][index].toBigInt(),
      };
    });
  }

  async getExpiration(interactionNonce: bigint): Promise<bigint> {
    const interaction = await this.elementBridgeContract.interactions(interactionNonce);

    return BigInt(interaction.expiry.toString());
  }

  async hasFinalised(interactionNonce: bigint): Promise<Boolean> {
    const interaction = await this.elementBridgeContract.interactions(interactionNonce);
    return interaction.finalised;
  }
}
