import { createRequire } from 'module';
import { ethers } from 'ethers';
import { Alchemy } from 'alchemy-sdk';
import { getWallet } from './getWallet.js';
import { getAlchemySettings } from '../utils/getAlchemySettings.js';

// Allows us to use require
const require = createRequire(import.meta.url);

// Uniswap V3 ABIs
const {
  abi: UNISWAP_V3_SWAP_ROUTER_02_ABI,
} = require('@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json');
const {
  abi: UNISWAP_V3_QUOTER_V2_ABI,
} = require('@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json');
const {
  abi: UNISWAP_V3_FACTORY_ABI,
} = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json');
const {
  abi: UNISWAP_V3_POOL_ABI,
} = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json');
const { abi: ERC20_ABI } = require('@uniswap/v2-core/build/ERC20.json');

/**     ****************   BUYS ARE IN WETH    ******************
 * This class has the functionality to trade tokens on uniswap v3 and comes with some helper functions that get prices, token amounts, set/remove swap listeners
 * keeps a list of positions & listeners, sets stop loss & target price.
 *
 * Hard coded to buy 0.00001 ETH and hard coded to sell 100% of a position. These values should be changed if one chooses to run this.
 */
export class UniswapV3 {
  chainId;
  wallet;
  alchemy;
  wethAddress;
  routerAddress;
  factoryAddress;
  quoterAddress;
  routerContract;
  factoryContract;
  quoterContract;

  /**
   * Constructor
   */
  constructor(chainId, routerAddress, factoryAddress, quoterAddress) {
    this.chainId = chainId;
    this.routerAddress = routerAddress;
    this.factoryAddress = factoryAddress;
    this.quoterAddress = quoterAddress;

    // Interfaces for decoding
    this.poolInterface = new ethers.Interface(UNISWAP_V3_POOL_ABI);
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

    // Create instance of alchemy
    this.alchemy = new Alchemy(getAlchemySettings(String(this.chainId)));

    // Router contract
    this.routerContract = new ethers.Contract(
      this.routerAddress,
      UNISWAP_V3_SWAP_ROUTER_02_ABI,
      this.wallet
    );

    // Factory contract
    this.factoryContract = new ethers.Contract(
      this.factoryAddress,
      UNISWAP_V3_FACTORY_ABI,
      this.wallet
    );

    // Quoter contract
    this.quoterContract = new ethers.Contract(
      this.quoterAddress,
      UNISWAP_V3_QUOTER_V2_ABI,
      this.wallet
    );

    // Get WETH address from router
    this.wethAddress = await this.routerContract.WETH9();
  }

  /**
   * Buy tokens using  WETH
   * @param {string} tokenAddress - Token to buy
   * @param {string} fee - Pool fee tier (500, 3000, 10000)
   */
  async buyToken(token) {
    // Get the token info
    const tokenAddress = token.newTokenAddress;
    const poolAddress = token.poolAddress;
    const fee = Number(token.fee);

    // Hard coded buy amount
    const ethAmount = 0.00001;

    // parse amount to ether
    const amountIn = ethers.parseEther(ethAmount.toString());

    // Check ETH balance
    const wethBalance = await this.getTokenBalance(this.wethAddress);

    // Make sure we have enought eth
    if (wethBalance < amountIn) {
      throw new Error(
        `Insufficient ETH balance. Need ${ethAmount} ETH, have ${ethers.formatEther(
          wethBalance
        )} ETH`
      );
    }

    // get the current price, stop loss, and target prices
    const { currentPrice, targetPrice, stopLoss } = await this.getTargetAndStopLoss(poolAddress);

    // Create the weth contract
    const wethContract = new ethers.Contract(this.wethAddress, ERC20_ABI, this.wallet);

    // Approve the router to take the amount in
    await wethContract.approve(this.routerAddress, ethers.MaxUint256);

    // Configure quote parameters
    const quoteParams = {
      tokenIn: this.wethAddress,
      tokenOut: tokenAddress,
      amountIn: amountIn,
      fee: fee,
      sqrtPriceLimitX96: 0,
    };

    // Get the quote
    const quoteResult = await this.quoterContract.quoteExactInputSingle.staticCall(quoteParams);

    // Set the amountOut and gasEstimate
    const amountOut = quoteResult[0];

    // Calculate minimum amount out with slippage
    const slippageMultiplier = BigInt(Math.floor((1 - this.slippageTolerance) * 10000));
    const minAmountOut = (amountOut * slippageMultiplier) / 10000n;

    // Parameters for the swap
    const params = {
      tokenIn: this.wethAddress,
      tokenOut: tokenAddress,
      fee: fee,
      recipient: this.wallet.address,
      amountIn: amountIn,
      amountOutMinimum: minAmountOut,
      sqrtPriceLimitX96: 0,
    };

    // Execute swap with value for ETH
    let tx;
    try {
      tx = await this.routerContract.exactInputSingle(params);
    } catch {
      console.error('****   UNISWAP V3 BUY FAIL   ****');
      return false;
    }

    // Wait for confirmation
    let receipt = null;
    for (let i = 0; i < 12; i++) {
      try {
        await new Promise(resolve => setTimeout(resolve, 5000));
        receipt = await this.alchemy.core.getTransactionReceipt(tx.hash);
        if (receipt) {
          if (receipt.status === 1) {
            console.log(`✅ Transaction confirmed in block: ${receipt.blockNumber}`);
            break;
          } else {
            console.error(`❌ Transaction failed with status: ${receipt.status}`);
            throw new Error(`Transaction reverted. Gas used: ${receipt.gasUsed}`);
          }
        }
      } catch (error) {
        if (error.message.includes('Transaction reverted')) {
          throw error;
        }
        console.log(`Attempt ${i + 1}: Receipt not ready yet...`);
      }
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
      token.poolAddress,
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
      amount: amountOut,
      entryTime: Date.now(),
    };
  }

  /**
   * Sell tokens for WETH
   * @param {string} tokenAddress - Token to sell
   * @param {number} fee - Pool fee tier
   */
  async sellToken(tokenAddress, fee) {
    fee = Number(fee);

    // Get the token balance
    const amountIn = await this.getTokenBalance(tokenAddress);

    // Stop if we don't have a token amount
    if (amountIn === 0n) {
      return;
    }

    // Create the token contract
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);

    // Approve the router to take the tokens
    await tokenContract.approve(this.routerAddress, ethers.MaxUint256);

    // Configure quote parameters (note: tokenIn and tokenOut are swapped)
    const quoteParams = {
      tokenIn: tokenAddress, // Now selling the token
      tokenOut: this.wethAddress, // Now receiving WETH
      amountIn: amountIn,
      fee: fee,
      sqrtPriceLimitX96: 0,
    };

    // Get the quote
    const quoteResult = await this.quoterContract.quoteExactInputSingle.staticCall(quoteParams);

    // Set the amountOut and gasEstimate
    const amountOut = quoteResult[0];

    // Calculate minimum amount out with slippage
    const slippageMultiplier = BigInt(Math.floor((1 - this.slippageTolerance) * 10000));
    const minAmountOut = (amountOut * slippageMultiplier) / 10000n;

    // Parameters for the swap (tokenIn and tokenOut swapped)
    const params = {
      tokenIn: tokenAddress, // Selling the token
      tokenOut: this.wethAddress, // Receiving WETH
      fee: fee,
      recipient: this.wallet.address,
      amountIn: amountIn,
      amountOutMinimum: minAmountOut,
      sqrtPriceLimitX96: 0,
    };

    let tx;
    // Execute swap
    try {
      tx = await this.routerContract.exactInputSingle(params);
    } catch {
      console.error('****   UNISWAP V3 SELL FAILED   ****');
      return { success: false, error: 'UNISWAP V3 SELL FAILED' };
    }

    // Wait for confirmation
    let receipt = null;
    for (let i = 0; i < 12; i++) {
      try {
        await new Promise(resolve => setTimeout(resolve, 5000));
        receipt = await this.alchemy.core.getTransactionReceipt(tx.hash);
        if (receipt) {
          if (receipt.status === 1) {
            console.log(`✅ Transaction confirmed in block: ${receipt.blockNumber}`);
            break;
          } else {
            console.error(`❌ Transaction failed with status: ${receipt.status}`);
            throw new Error(`Transaction reverted. Gas used: ${receipt.gasUsed}`);
          }
        }
      } catch (error) {
        if (error.message.includes('Transaction reverted')) {
          throw error;
        }
        console.log(`Attempt ${i + 1}: Receipt not ready yet...`);
      }
    }

    // remove the target listener
    await this.stopTargetListener(tokenAddress);

    // Remove the the token from the positions
    this.positions.delete(tokenAddress);

    return {
      success: true,
      txHash: tx.hash,
      amountOut: amountOut,
      exitTime: Date.now(),
    };
  }

  /**
   * Get token price in terms of ETH
   * @param {string} poolAddress - The Uniswap V3 pool address
   * @returns {Promise<number>} - Price of the non-ETH token in terms of ETH
   */
  async getPrice(poolAddress) {
    try {
      const poolContract = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, this.wallet);

      // Get slot0 data
      const slot0 = await poolContract.slot0();
      const sqrtPriceX96 = slot0.sqrtPriceX96;

      // Get token addresses
      const token0Address = await poolContract.token0();
      const token1Address = await poolContract.token1();

      const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, this.wallet);
      const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, this.wallet);

      const token0Decimals = await token0Contract.decimals();
      const token1Decimals = await token1Contract.decimals();

      // Calculate the raw price (token0 in terms of token1)
      const Q96 = 2n ** 96n;
      const sqrtPrice = BigInt(sqrtPriceX96.toString());

      const numerator = sqrtPrice * sqrtPrice;
      const denominator = Q96 * Q96;

      const decimalAdjustment = 10n ** BigInt(token0Decimals - token1Decimals);
      const price = (numerator * decimalAdjustment) / denominator;

      const rawPrice = parseFloat(ethers.formatUnits(price, 0));

      // Determine which token is WETH/ETH
      const wethAddress = this.wethAddress.toLowerCase();

      if (token0Address.toLowerCase() === wethAddress) {
        return 1 / rawPrice;
      } else if (token1Address.toLowerCase() === wethAddress) {
        return rawPrice;
      } else {
        throw new Error('This pool does not contain WETH');
      }
    } catch (error) {
      console.error('Error getting price:', error);
      return null;
    }
  }

  /**
   * Calculate market cap for a token
   * @param {string} tokenAddress - Token contract address
   * @param {string} poolAddress - Uniswap V3 pool address (token paired with USDC/USDT/etc)
   * @returns {Promise<number>}
   */
  async getMarketCap(tokenAddress, poolAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      const totalSupply = await tokenContract.totalSupply();
      const decimals = await tokenContract.decimals();

      const price = await this.getPrice(poolAddress);

      const supply = parseFloat(ethers.formatUnits(totalSupply, decimals));
      const marketCap = supply * price;

      return marketCap;
    } catch (error) {
      console.error('Failed to get market cap:', error);
      return 0;
    }
  }

  /**
   * Gets the current price, stop loss, and target price, in terms of ETH.
   * @param {string} tokenAddress
   * @returns
   */
  async getTargetAndStopLoss(poolAddress, targetMultiplier = 2, stopLossMultiplier = 0.5) {
    const currentPrice = await this.getPrice(poolAddress);
    return {
      currentPrice,
      targetPrice: currentPrice * targetMultiplier,
      stopLoss: currentPrice * stopLossMultiplier,
    };
  }

  /**
   * Get pool address for token pair and fee
   */
  async getPoolAddress(tokenA, tokenB, fee) {
    try {
      const poolAddress = await this.factoryContract.getPool(tokenA, tokenB, fee);
      if (poolAddress === ethers.ZeroAddress) {
        throw new Error('Pool does not exist');
      }
      return poolAddress;
    } catch (error) {
      console.error('Failed to get pool address:', error);
      return null;
    }
  }

  /**
   * Start target listener for swap events
   */
  async startTargetListener(tokenAddress, poolAddress, targetPrice, stopLoss) {
    try {
      // Create filter for Swap events
      const filter = {
        address: poolAddress,
        topics: [this.poolInterface.getEvent('Swap').topicHash],
      };

      const listener = async () => {
        try {
          console.log('🔄 Swap event detected');

          const currentPrice = await this.getPrice(poolAddress);
          const position = this.positions.get(tokenAddress);

          if (!position) return;

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
        poolAddress,
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
   * Stop target listener
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
   * Execute sell and gives displays if it was a stop loss or target price hit
   */
  async executeSell(tokenAddress, reason) {
    try {
      const position = this.positions.get(tokenAddress);
      if (!position) return;

      console.log(`Selling tokens due to: ${reason}`);

      const result = await this.sellToken(tokenAddress, position.fee);

      // Stop the listener after selling
      await this.stopTargetListener(tokenAddress);

      return result;
    } catch (error) {
      console.error('Auto-sell failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Gets balance for a given token address
   */
  async getTokenBalance(tokenAddress) {
    if (!this.wallet) return 0n;
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
    return await tokenContract.balanceOf(this.wallet.address);
  }

  /**
   * Gets a tokens decimals
   */
  async getTokenDecimals(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      return await tokenContract.decimals();
    } catch (error) {
      console.error('Failed to get token decimals:', error);
      return 18;
    }
  }

  /**
   * Get all of the token info
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
   * Gets all of the active swap listeners
   */
  getActiveListeners() {
    return Array.from(this.listeners.entries()).map(([tokenAddress, info]) => ({
      tokenAddress,
      startTime: info.startTime,
      config: info.tokenConfig,
    }));
  }

  /**
   * Gets all of the current positions
   */
  getPositions() {
    return Array.from(this.positions.entries()).map(([tokenAddress, position]) => ({
      tokenAddress,
      ...position,
    }));
  }

  /**
   * stops all listeners
   */
  async stopAllListeners() {
    const promises = Array.from(this.listeners.keys()).map(tokenAddress =>
      this.stopTargetListener(tokenAddress)
    );
    await Promise.all(promises);
    console.log('🛑 All listeners stopped');
  }
}
