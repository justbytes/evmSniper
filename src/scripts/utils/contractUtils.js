const { ethers } = require("ethers");

const {
  v2GetPrice,
  v2TargetListener,
  v2ProcessPriceMovement,
} = require("./v2ContractUtils");

const {
  v3GetPrice,
  v3TargetListener,
  v3ProcessPriceMovement,
} = require("./v3ContractUtils");

const {
  abi: ERC20_ABI,
} = require("@openzeppelin/contracts/build/contracts/ERC20.json");

/**
 * Gets the number of decimals for a token
 * @param tokenAddress
 * @returns the number of decimals
 */
const getTokenDecimals = async (tokenAddress) => {
  try {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ERC20_ABI,
      await this.alchemy.config.getProvider()
    );
    const decimals = await tokenContract.decimals();
    return decimals;
  } catch (error) {
    console.error("There was a problem getting decimals! \n", error);
  }

  /**
   * Increases a value by a percentage
   * @param {BigInt} value
   * @param {number} percentage
   * @returns the new value
   */
  const increaseByPercentage = (value, percentage) => {
    // Convert percentage to basis points (1% = 100 basis points)
    const basisPoints = BigInt(percentage * 100);

    // Perform the calculation
    const increase = (value * basisPoints) / BigInt(10000);
    const newValue = value + increase;

    return newValue;
  };
  /**
   * set a target price of 25% higher than the current price
   */
  const calculateTargetPrice = async () => {
    // TODO: return a promise
    // Get the current price and update the instance variable
    const currentPrice = await this.dodoEggMonitor.getPrice();
    //this.intialPrice = currentPrice;

    // Set the target price by increasing the current price 25%
    const basisPoints = BigInt(25 * 100);

    // Perform the calculation
    const increase = (currentPrice * basisPoints) / BigInt(10000);
    this.targetPrice = currentPrice + increase;

    return this.targetPrice;
  };

  /**
   * Gets the price for the given version
   * @param {string} version
   * @returns the price
   */
  const getPrice = async (version) => {
    if (version === "v2") {
      return { price: await v2GetPrice() };
    } else {
      return { price: await v3GetPrice() };
    }
  };
};

const startTargetListener = async (version) => {
  // TODO: return a promise
  if (version === "v2") {
    await v2TargetListener();
  } else {
    await v3TargetListener();
  }
};

/**
 * Gets the number of target listeners
 * @returns number of target listeners
 */
const getTargetListeners = async () => {
  // TODO: return a promise?
  return await this.alchemy.ws.listenerCount(
    this.dodoEgg.targetListener.filters
  );
};

/**
 * Removes a target listener event filter
 */
const removeTargetListener = async () => {
  // TODO: return a promise?
  this.alchemy.ws.off(
    this.dodoEgg.targetListener.filter,
    this.dodoEgg.targetListener.listener
  );
  // // clean up target listener
  // this.dodoEgg.targetListener = null;
};

/**
 * Restarts the target listener
 */
const restartTargetListener = async () => {
  // TODO: return a promise?
  try {
    this.alchemy.ws.on(
      this.dodoEgg.targetListener.filter,
      this.dodoEgg.targetListener.listener
    );
  } catch (error) {
    console.log("There was an error restarting the target listener! \n", error);
  }
};

module.exports = {
  getTokenDecimals,
  getTargetListeners,
  removeTargetListener,
  restartTargetListener,
  calculateTargetPrice,
  getPrice,
  startTargetListener,
};
