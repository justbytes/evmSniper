/**
 * Gets the price of the pair
 * @returns the price in terms of base token
 */
export const v2GetPriceWithPairAddress = async (pairAddress) => {
  let token0, token1, pairContract;

  // Get the pair contract
  try {
    pairContract = new ethers.Contract(
      pairAddress,
      IUniswapV2PairABI,
      await this.alchemy.config.getProvider()
    );
  } catch (error) {
    console.error("Error with getting pair contract", error);
    return false;
  }

  // Get the reserve0 and reserve1
  const [reserve0, reserve1] = await pairContract.getReserves();

  console.log("RESERVE0 FROM GET PRICE", reserve0);
  console.log("RESERVE1 FROM GET PRICE", reserve1);

  // Get the token0 and token1 addresses
  try {
    token0 = await pairContract.token0();
    token1 = await pairContract.token1();
  } catch (error) {
    console.log("Error with getting token0", error);
  }

  console.log("TOKEN0 FROM GET PRICE", token0);
  console.log("TOKEN1 FROM GET PRICE", token1);

  // Only get decimals if they are not already set
  if (
    this.dodoEgg.baseTokenDecimal == null &&
    this.dodoEgg.newTokenDecimal == null
  ) {
    // Get and set base token decimals
    const baseDecimal = await this.getTokenDecimals(
      this.dodoEgg.baseTokenAddress
    );
    this.dodoEgg.setBaseTokenDecimals(baseDecimal);

    // Get and set new token decimals
    const newDecimal = await this.getTokenDecimals(
      this.dodoEgg.newTokenAddress
    );
    this.dodoEgg.setNewTokenDecimals(newDecimal);
  }

  // Adjust the big number to
  const reserve0Adjusted = ethers.parseUnits(
    reserve0.toString(),
    18 - Number(this.dodoEgg.baseTokenDecimal)
  );
  const reserve1Adjusted = ethers.parseUnits(
    reserve1.toString(),
    18 - Number(this.dodoEgg.newTokenDecimal)
  );

  if (this.dodoEgg.baseTokenAddress.toLowerCase() === token0.toLowerCase()) {
    const price = (reserve0Adjusted * ethers.WeiPerEther) / reserve1Adjusted;

    this.dodoEgg.setBaseAssetReserve(0);

    this.dodoEgg.setIntialPrice(price);

    console.log("PRICE FROM GET PRICE", price);

    return price;
  } else {
    const price = (reserve1Adjusted * ethers.WeiPerEther) / reserve0Adjusted;
    this.dodoEgg.setBaseAssetReserve(1);
    this.dodoEgg.setIntialPrice(price);
    return price;
  }
};

/**
 * Activates v2 target listener
 */
export const v2TargetListener = async () => {
  // Filter for a sync event
  const filter = {
    address: this.dodoEgg.pairAddress,
    topics: [IUNISWAPV2PAIR_INTERFACE.getEvent("Swap").topicHash],
  };

  const listener = (log) => {
    console.log("Checking sync for updated price");

    // Check the price movement to see is it went above the targetPrice
    decodeSyncLog(log);
  };

  // Listen to sync events
  this.alchemy.ws.on(filter, listener);

  this.dodoEgg.targetListener = { filter: filter, listener: listener };
};

/**
 * Decode v2 data from listener
 * @param log
 */
const decodeSwapLog = (log) => {
  // Decode log data

  const { reserve0, reserve1 } = decodedLog.args;
};

import { ethers } from "ethers";

import { IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";

import { IERC20_ABI } from "@openzeppelin/contracts/build/contracts/IERC20.json";

/**
 * Queries slot0 for token info
 * @returns the sqrtX96Price of the pool
 */
export const v3GetPrice = async () => {
  try {
    const poolContract = new ethers.Contract(
      this.dodoEgg.pairAddress,
      IUniswapV3PoolABI,
      await this.alchemy.config.getProvider()
    );

    const price = await poolContract.slot0();
    this.dodoEgg.baseTokenDecimal = await this.getTokenDecimals(
      this.dodoEgg.baseTokenAddress
    );

    this.dodoEgg.newTokenDecimal = await this.getTokenDecimals(
      this.dodoEgg.newTokenAddress
    );

    return price[0];
  } catch (error) {
    console.error("There was a problem getting v3 price!\n", error);
    return false;
  }
};

/**
 * Activates the v3 target listener
 */
export const v3TargetListener = async () => {
  // Filter for swap events
  const filter = {
    address: this.dodoEgg.pairAddress,
    topics: [IUniswapV3PoolInterface.getEvent("Swap").topicHash],
  };

  // Listen for swap events
  const listener = (log) => {
    console.log("Checking swap for updated price");

    // Check the price movement to see is it went above the targetPrice
    this.processPriceMovement(log);
  };

  // Listen to sync events
  this.alchemy.ws.on(filter, listener);

  // Set the targetListener instance varible
  this.dodoEgg.targetListener = { filter: filter, listener: listener };
};

/**
 * Decode v3 listener log for price data
 * @param log encoded output from listener
 */
export const v3ProcessPriceMovement = async (log) => {
  const decodedLog = IUniswapV3PoolInterface.parseLog(log);
  const { sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick } =
    decodedLog.args;

  const filter = IUniswapV3PoolInterface.encodeFunctionData("balanceOf", [
    this.dodoEgg.pairAddress,
  ]);

  // Call for the balance
  const baseAssetBalance = BigInt(
    await this.alchemy.core.call({
      to: this.dodoEgg.baseTokenAddress,
      data: filter,
    })
  );

  const zero = ethers.parseUnits(
    "0.001",
    Number(this.dodoEgg.baseTokenDecimal)
  );

  if (baseAssetBalance < zero) {
    // Signal that rug pull took place
    console.log(
      `!!***  RUG PULL DETECTED  ***!!\n *****  Pair Address: ${this.dodoEgg.pairAddress}  ******\n *****  Base Token Address: ${this.dodoEgg.baseTokenAddress}  ******\n *****  New Token Address: ${this.dodoEgg.newTokenAddress}  ******\n`
    );
    this.dodoEgg.tradeInProgress = false;
    this.stopTargetListener();
    // TODO: Send pair to DodoDetective
    //  ( Not yet implemented but will conduct audit on tokens
    //    and identifiy cause type of rug pull and investigate
    //    the addressess assosiated with )
  }

  if (sqrtPriceX96 > this.dodoEgg.targetPrice) {
    // TODO: Sell tokens for profit
    this.dodoEgg.tradeInProgress = false;
    this.stopTargetListener();
    console.log(
      `
*****************************************************************
*****************************************************************
**********
**********            Listener has been deactivated V3!!!
**********    TIME TO SELL ${sqrtPriceX96}
**********    Target Price ${this.dodoEgg.targetPrice}
**********    Pair Address: ${this.dodoEgg.pairAddress}
**********
*****************************************************************
*****************************************************************
*****************************************************************
      `
    );
    console.log("");
  } else {
    console.log("Pair: ", this.dodoEgg.pairAddress);
    console.log("Current price: ", currentPrice);
    console.log("Target price: ", this.dodoEgg.targetPrice);
    console.log("Difference: ", currentPrice - this.dodoEgg.targetPrice);
    console.log("");
  }
};
