import { createRequire } from 'module';
import { ethers } from 'ethers';
import { Alchemy } from 'alchemy-sdk';
import { getWallet } from './getWallet.js';
import { getAlchemySettings } from '../utils/getAlchemySettings.js';

// Allows us to use require
const require = createRequire(import.meta.url);

// Import abis
const {
  abi: UNISWAP_V2_ROUTER_ABI,
} = require('@uniswap/v2-periphery/build/IUniswapV2Router02.json');
const { abi: UNISWAP_V2_PAIR_ABI } = require('@uniswap/v2-core/build/UniswapV2Pair.json');
const { abi: UNISWAP_V2_FACTORY_ABI } = require('@uniswap/v2-core/build/UniswapV2Factory.json');
const { abi: ERC20_ABI } = require('@uniswap/v2-core/build/ERC20.json');

/**     ****************   BUYS ARE IN ETH    ******************
 * This class has the functionality to trade tokens on uniswap v2 and comes with some helper functions that get prices, token amounts, set/remove swap listeners
 * keeps a list of positions, sets stop loss & target price.
 *
 * Hard coded to buy 0.00001 ETH and hard coded to sell 100% of a position. These values should be changed if one chooses to run this.
 */
export class UniswapV2 {
  chainId;
  wallet;
  alchemy;
  wethAddress;
  routerAddress;
  factoryAddress;
  routerContract;
  factoryContract;

  /**
   * Constructor
   * @param {string} chainId - id of blockchain
   * @param {string} routerAddress a uniswap based router address
   * @param {string} factoryAddress a uniswap based factory address
   */
  constructor(chainId, routerAddress, factoryAddress) {
    this.chainId = chainId;
    this.routerAddress = routerAddress;
    this.factoryAddress = factoryAddress;

    // Interfaces for decoding
    this.pairInterface = new ethers.Interface(UNISWAP_V2_PAIR_ABI);
    this.erc20Interface = new ethers.Interface(ERC20_ABI);

    // State management
    this.listeners = new Map();
    this.positions = new Map();

    // Default settings
    this.slippageTolerance = 0.02; // 2%
  }

  /**
   * Creates the contracts, weth address, and wallet
   */
  async initialize() {
    // Create a wallet instance
    this.wallet = await getWallet(this.chainId);

    // Get an alchemy instance
    this.alchemy = new Alchemy(getAlchemySettings(String(this.chainId)));

    // Router contract
    this.routerContract = new ethers.Contract(
      this.routerAddress,
      UNISWAP_V2_ROUTER_ABI,
      this.wallet
    );

    // Factory contract
    this.factoryContract = new ethers.Contract(
      this.factoryAddress,
      UNISWAP_V2_FACTORY_ABI,
      this.wallet
    );

    // Get WETH address based off of router
    this.wethAddress = await this.routerContract.WETH();
  }

  /**
   * Buys a token using native ETH sets a swap listener for the pair and waits for stop loss or target price to sell
   * @param {*} token will be a token obejct that comes from the Websocket server
   * @returns
   */
  async buyToken(token) {
    const ethAmount = 0.000001;
    const tokenAddress = token.newTokenAddress;

    // Get currentPrice, targetPrice, and stop loss for the token pair
    const { currentPrice, targetPrice, stopLoss } = await this.getTargetAndStopLoss(tokenAddress);

    // Parameters for swap
    const deadline = Math.floor(Date.now() / 1000) + 120; // 2 min deadline
    const path = [this.wethAddress, tokenAddress]; // WETH to token path
    const amountIn = ethers.parseEther(ethAmount.toString()); // Amount of ETH to spend

    // Check ETH balance first
    const ethBalance = await this.getETHBalance();

    // Get expected output
    const amountsOut = await this.routerContract.getAmountsOut(amountIn, path);
    const expectedOut = amountsOut[1];
    const minAmountOut =
      (expectedOut * BigInt(Math.floor((1 - this.slippageTolerance) * 1000))) / 1000n;

    // Estimate gas for the transaction
    const gasEstimate = await this.routerContract.swapExactETHForTokens.estimateGas(
      minAmountOut,
      path,
      this.wallet.address,
      deadline,
      { value: amountIn }
    );

    // Convert to BigInt and add 20% buffer
    const gasEstimateBigInt = gasEstimate.toBigInt ? gasEstimate.toBigInt() : BigInt(gasEstimate);
    const gasLimit = (gasEstimateBigInt * 120n) / 100n;

    // Calculate gas cost using Alchemy provider
    const gasPrice = await this.alchemy.core.getGasPrice();
    const gasPriceBigInt = gasPrice.toBigInt ? gasPrice.toBigInt() : BigInt(gasPrice);
    const gasCost = gasLimit * gasPriceBigInt;

    // Check if we have enough ETH for swap + gas
    const totalCost = amountIn + gasCost;
    if (ethBalance < totalCost) {
      throw new Error(
        `Insufficient ETH. Need ${ethers.formatEther(totalCost)} ETH, have ${ethers.formatEther(
          ethBalance
        )} ETH`
      );
    }

    let tx;
    // Make the swap
    try {
      tx = await this.routerContract.swapExactETHForTokens(
        minAmountOut,
        path,
        this.wallet.address,
        deadline
      );
    } catch (error) {
      console.error('****    UNISWAP V2 BUY FAILED   ****');
      return false;
    }

    // Get the transaction receipt
    let receipt = null;
    for (let i = 0; i < 6; i++) {
      // Try 6 times (30 seconds total)
      try {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 5 seconds each time
        receipt = await this.alchemy.core.getTransactionReceipt(tx.hash);
        if (receipt && receipt.blockNumber) {
          console.log(`**** UNISWAP V3 BUY SUCCESS ON BLOCK: ${receipt.blockNumber}`);
          break;
        }
      } catch (error) {
        console.log(`Attempt ${i + 1}: Receipt not ready yet...`);
      }
    }

    // Warning if we didn't get a receipt
    if (!receipt) {
      console.warn('Transaction sent but could not confirm receipt after 30 seconds');
    }

    // Store position info
    this.positions.set(tokenAddress, {
      ...token,
      entryPrice: currentPrice,
      amount: expectedOut,
      entryTime: Date.now(),
      txHash: tx.hash,
    });

    // start the target listener
    const started = await this.startTargetListener(
      tokenAddress,
      token.pairAddress,
      targetPrice,
      stopLoss
    );

    // Throw an error if the listener didn't start
    if (!started) {
      throw new Error('****   TARGET LISTENER FAILED TO START   ****');
    }

    return {
      success: true,
      txHash: tx.hash,
      entryPrice: currentPrice,
      amount: expectedOut,
      entryTime: Date.now(),
    };
  }

  /**
   * Sells 100% of a token position
   * @param {string} tokenAddress
   * @returns
   */
  async sellToken(tokenAddress) {
    // Set up swap parameters
    const deadline = Math.floor(Date.now() / 1000) + 120;
    const path = [tokenAddress, this.wethAddress];

    // Get token info
    const decimals = await this.getTokenDecimals(tokenAddress);
    const tokenBalance = await this.getTokenBalance(tokenAddress);
    const tokenInfo = await this.getTokenInfo(tokenAddress);

    console.log(`📊 Token Info: ${tokenInfo?.name} (${tokenInfo?.symbol})`);
    console.log(`📊 Token Balance: ${ethers.formatUnits(tokenBalance, decimals)}`);
    console.log(`📊 Decimals: ${decimals}`);

    // Use the full balance
    const amountIn = tokenBalance;

    // Return if we don't have tokens
    if (amountIn === 0n) {
      throw new Error('No tokens to sell!');
    }

    // Make token contract instance
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);

    // approve the tx amount
    await tokenContract.approve(
      this.routerAddress,
      ethers.MaxUint256 // Approve unlimited
    );

    // Get the estimated amount out and calculate the minAmountout
    const amountsOut = await this.routerContract.getAmountsOut(amountIn, path);
    const expectedOut = amountsOut[1];
    const minAmountOut =
      (expectedOut * BigInt(Math.floor((1 - this.slippageTolerance) * 1000))) / 1000n;

    let tx;
    // Make the swap
    try {
      tx = await this.routerContract.swapExactTokensForETH(
        amountIn,
        minAmountOut,
        path,
        this.wallet.address,
        deadline
      );
    } catch (error) {
      console.error('****   UNISWAP V2 SELL FAILED   ****');
      return { success: false, error: error.message };
    }

    // remove the target listener
    await this.stopTargetListener(tokenAddress);

    // Remove the the token from the positions
    this.positions.delete(tokenAddress);

    return {
      success: true,
      txHash: tx.hash,
      amountOut: expectedOut,
      exitTime: Date.now(),
    };
  }

  /**
   * Starts a target listener on a token for swap events
   * @param {string} tokenAddress
   * @param {string} pairAddress
   * @param {*} targetPrice
   * @param {*} stopLoss
   * @returns
   */
  async startTargetListener(tokenAddress, pairAddress, targetPrice, stopLoss) {
    try {
      // Create filter for Swap events
      const filter = {
        address: pairAddress,
        topics: [this.pairInterface.getEvent('Swap').topicHash],
      };

      // Listener that checks the stopLoss and targetPrice. If we hit one of them it sells all of the tokens
      const listener = async () => {
        try {
          console.log('🔄 Swap event detected');

          const currentPrice = await this.getPrice(tokenAddress);
          const position = this.positions.get(tokenAddress);

          if (!position) return;

          console.log(`Current price: $${currentPrice}`);
          console.log(`Target: $${targetPrice}, Stop Loss: $${stopLoss}`);

          // Check target price
          if (targetPrice && currentPrice >= targetPrice) {
            console.log('🚀 Target price reached! Executing sell...');
            await this.executeSell(tokenAddress, 'TARGET_HIT');
          }

          // Check stop loss
          if (stopLoss && currentPrice <= stopLoss) {
            console.log('🛑 Stop loss triggered! Executing sell...');
            await this.executeSell(tokenAddress, 'STOP_LOSS');
          }
        } catch (error) {
          console.error('Error in swap listener:', error);
        }
      };

      // Start listening
      this.alchemy.ws.on(filter, listener);

      // Store listener info
      this.listeners.set(tokenAddress, {
        filter,
        listener,
        tokenAddress,
        pairAddress,
        targetPrice,
        stopLoss,
        startTime: Date.now(),
      });

      console.log(`👂 Started listening for ${tokenAddress}`);
      return true;
    } catch (error) {
      console.error('Failed to start listener:', error);
      return false;
    }
  }

  /**
   * Stops the target listener for a given token
   * @param {*} tokenAddress
   * @returns
   */
  async stopTargetListener(tokenAddress) {
    const listenerInfo = this.listeners.get(tokenAddress);
    if (!listenerInfo) {
      console.log('No listener found for token');
      return false;
    }

    try {
      this.alchemy.ws.off(listenerInfo.filter, listenerInfo.listener);
      this.listeners.delete(tokenAddress);
      console.log(`🔇 Stopped listening for ${tokenAddress}`);
      return true;
    } catch (error) {
      console.error('Failed to stop listener:', error);
      return false;
    }
  }

  /**
   * Gets the price of a token in terms of ETH
   * @param {*} tokenAddress
   * @returns
   */
  async getPrice(tokenAddress) {
    try {
      const path = [tokenAddress, this.wethAddress];
      const tokenDecimals = await this.getTokenDecimals(tokenAddress);
      const oneToken = ethers.parseUnits('1', tokenDecimals);

      const amountsOut = await this.routerContract.getAmountsOut(oneToken, path);
      const priceInWeth = amountsOut[1];

      // Convert to USD (you'd need to get ETH price from an oracle or API)
      // For now, returning price in ETH
      return parseFloat(ethers.formatEther(priceInWeth));
    } catch (error) {
      console.error('Failed to get price:', error);
      return 0;
    }
  }

  /**
   * Gets the market cap of a token in terms of ETH
   * @param {*} tokenAddress
   * @returns
   */
  async getMarketCap(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      const totalSupply = await tokenContract.totalSupply();
      const decimals = await this.getTokenDecimals(tokenAddress);
      const price = await this.getPrice(tokenAddress);

      const supply = parseFloat(ethers.formatUnits(totalSupply, decimals));
      return supply * price;
    } catch (error) {
      console.error('Failed to get market cap:', error);
      return 0;
    }
  }

  /**
   * Gets estimated amount out of a trade
   * @param {*} amountIn - amount to trade
   * @param {*} tokenIn - token address to buy with
   * @param {*} tokenOut - token address to recieve
   * @returns
   */
  async getAmountOut(amountIn, tokenIn, tokenOut) {
    try {
      const path = [tokenIn, tokenOut];
      const amountsOut = await this.routerContract.getAmountsOut(amountIn, path);
      return amountsOut[1];
    } catch (error) {
      console.error('Failed to get amount out:', error);
      return 0n;
    }
  }

  /**
   * Gets the current price, stop loss, and target price, in terms of ETH.
   * @param {*} tokenAddress
   * @param {*} targetMultiplier
   * @param {*} stopLossMultiplier
   * @returns
   */
  async getTargetAndStopLoss(tokenAddress, targetMultiplier = 2, stopLossMultiplier = 0.5) {
    const currentPrice = await this.getPrice(tokenAddress);
    return {
      currentPrice,
      targetPrice: currentPrice * targetMultiplier,
      stopLoss: currentPrice * stopLossMultiplier,
    };
  }

  /**
   * Gets the decimals for a token
   * @param {string} tokenAddress
   * @returns
   */
  async getTokenDecimals(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      return await tokenContract.decimals();
    } catch (error) {
      console.error('Failed to get token decimals:', error);
      return 18; // Default to 18
    }
  }

  /**
   * Gets the token info: name, symbol, decimals, totalSupply
   * @param {string} tokenAddress target address to get info
   * @returns
   */
  async getTokenInfo(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        tokenContract.name(),
        tokenContract.symbol(),
        tokenContract.decimals(),
        tokenContract.totalSupply(),
      ]);

      return { name, symbol, decimals, totalSupply };
    } catch (error) {
      console.error('Failed to get token info:', error);
      return null;
    }
  }

  /**
   * Returns the pair address assositated of two input tokens
   * @param {string} tokenA
   * @param {string} tokenB
   * @returns a pair address
   */
  async getPairAddress(tokenA, tokenB) {
    try {
      const pairAddress = await this.factoryContract.getPair(tokenA, tokenB);
      if (pairAddress === ethers.ZeroAddress) {
        throw new Error('Pair does not exist');
      }
      return pairAddress;
    } catch (error) {
      console.error('Failed to get pair address:', error);
      return null;
    }
  }

  /**
   * Sells all of the tokens and displays if we are selling because of a stop loss or target price hit
   */
  async executeSell(tokenAddress, reason) {
    try {
      const position = this.positions.get(tokenAddress);
      if (!position) return;

      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      const balance = await tokenContract.balanceOf(this.wallet.address);
      const decimals = await this.getTokenDecimals(tokenAddress);
      const amount = ethers.formatUnits(balance, decimals);

      console.log(`Selling ${amount} tokens due to: ${reason}`);

      const result = await this.sellToken(tokenAddress);

      return result;
    } catch (error) {
      console.error('Auto-sell failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Gets this.wallets.address ETH balance
   * @returns
   */
  async getETHBalance() {
    if (!this.wallet) return 0n;
    const balance = await this.alchemy.core.getBalance(this.wallet.address);
    return balance.toBigInt(); // Convert BigNumber to BigInt
  }

  /**
   * Gets the balance of a target token for this.wallet.address
   * @param {string} tokenAddress
   * @returns
   */
  async getTokenBalance(tokenAddress) {
    if (!this.wallet) return 0n;
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
    return await tokenContract.balanceOf(this.wallet.address);
  }

  /**
   * Get all active listeners
   * @returns
   */
  getActiveListeners() {
    return Array.from(this.listeners.entries()).map(([tokenAddress, info]) => ({
      tokenAddress,
      startTime: info.startTime,
      config: info.tokenConfig,
    }));
  }

  /**
   * Get all positions
   * @returns
   */
  getPositions() {
    return Array.from(this.positions.entries()).map(([tokenAddress, position]) => ({
      tokenAddress,
      ...position,
    }));
  }

  /**
   * Emergency stop all listeners
   */
  async stopAllListeners() {
    const promises = Array.from(this.listeners.keys()).map(tokenAddress =>
      this.stopTargetListener(tokenAddress)
    );
    await Promise.all(promises);
    console.log('🛑 All listeners stopped');
  }
}
