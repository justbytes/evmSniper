const { Alchemy } = require("alchemy-sdk");
const getAlchemySettings = require("../utils/getAlchemySettings");

class TokenData {
  /**
   * Constructor for a DodoEgg
   * @param {uuid} id
   * @param {number} chainId
   * @param {string} newTokenAddress
   * @param {string} baseTokenAddress
   * @param {string} pairAddress
   * @param {boolean} v3
   * @param {number} fee
   * @param {object} auditResults
   * @param {number} intialPrice
   * @param {number} targetPrice
   * @param {boolean} tradeInProgress
   * @param {number} baseTokenDecimal
   * @param {number} newTokenDecimal
   * @param {number} baseAssetReserve
   * @param {function} liquidityListener
   * @param {function} targetListener
   */
  constructor(
    id,
    chainId,
    newTokenAddress,
    baseTokenAddress,
    pairAddress,
    v3,
    fee,
    auditResults,
    intialPrice,
    targetPrice,
    tradeInProgress,
    baseTokenDecimal,
    newTokenDecimal,
    baseAssetReserve,
    liquidityListener,
    targetListener
  ) {
    this.id = id;
    this.chainId = chainId;
    this.newTokenAddress = newTokenAddress;
    this.baseTokenAddress = baseTokenAddress;
    this.pairAddress = pairAddress;
    this.v3 = v3;
    this.fee = fee;
    this.auditResults = auditResults;
    this.intialPrice = intialPrice;
    this.targetPrice = targetPrice;
    this.tradeInProgress = tradeInProgress;
    this.baseTokenDecimal = baseTokenDecimal;
    this.newTokenDecimal = newTokenDecimal;
    this.baseAssetReserve = baseAssetReserve;
    this.liquidityListener = liquidityListener;
    this.targetListener = targetListener;
    this.alchemy = new Alchemy(getAlchemySettings(chainId));
  }

  /**
   * @returns current dodo egg info
   */
  getTokenData() {
    return {
      id: this.id,
      chainId: this.chainId,
      newToken: this.newTokenAddress,
      baseToken: this.baseTokenAddress,
      pairAddress: this.pairAddress,
      v3: this.v3,
      fee: this.fee,
      auditResults: this.auditResults,
      intialPrice: this.intialPrice == null ? "0" : this.intialPrice.toString(),
      targetPrice: this.targetPrice == null ? "0" : this.targetPrice.toString(),
      tradeInProgress: this.tradeInProgress,
      baseTokenDecimal: this.baseTokenDecimal,
      newTokenDecimal: this.newTokenDecimal,
      baseAssetReserve: this.baseAssetReserve,
      liquidityListener: this.liquidityListener,
      targetListener: this.targetListener,
    };
  }
}

module.exports = TokenData;
