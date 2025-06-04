const { ethers } = require("ethers");

const {
  abi: IUniswapV3PoolABI,
} = require("@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json");

const {
  abi: IERC20_ABI,
} = require("@openzeppelin/contracts/build/contracts/IERC20.json");

/**
 * Queries slot0 for token info
 * @returns the sqrtX96Price of the pool
 */
const v3GetPrice = async () => {
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
const v3TargetListener = async () => {
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
const v3ProcessPriceMovement = async (log) => {
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

module.exports = {
  v3GetPrice,
  v3TargetListener,
  v3ProcessPriceMovement,
};
