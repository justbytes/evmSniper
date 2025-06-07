import { createRequire } from 'module';
import { ethers } from 'ethers';
import { Alchemy } from 'alchemy-sdk';
import { getWallet } from './getWallet.js';
import { getAlchemySettings } from '../utils/getAlchemySettings.js';

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

/**
 * Uniswap V3 Trading Class
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
    this.alchemy = new Alchemy(getAlchemySettings(String(this.chainId)));

    // Router contract (SwapRouter)
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

    // Quoter contract (for price quotes)
    this.quoterContract = new ethers.Contract(
      this.quoterAddress,
      UNISWAP_V3_QUOTER_V2_ABI,
      this.wallet
    );

    // Get WETH address from router
    this.wethAddress = await this.routerContract.WETH9();
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
        // token0 is WETH, token1 is the target token
        // rawPrice = token0/token1 = WETH/token1
        // We want token1/WETH, so return 1/rawPrice
        return 1 / rawPrice;
      } else if (token1Address.toLowerCase() === wethAddress) {
        // token1 is WETH, token0 is the target token
        // rawPrice = token0/token1 = token0/WETH
        // We want token0/WETH, so return rawPrice directly
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
   * @returns {Promise<number>} - Market cap in USD
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
   * @param {*} tokenAddress
   * @param {*} targetMultiplier
   * @param {*} stopLossMultiplier
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
  async buyToken(tokenAddress, ethAmount = 0.00001, fee) {
    try {
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
      const gasEstimate = quoteResult[3];
      console.log(quoteResult);

      // Calculate minimum amount out with slippage
      const slippageMultiplier = BigInt(Math.floor((1 - this.slippageTolerance) * 10000));
      const minAmountOut = (amountOut * slippageMultiplier) / 10000n;
      const gasLimit = (gasEstimate * 150n) / 100n;

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
      } catch (error) {
        console.error('Simulation failed:', error);
        return { success: false, error: 'Simulation failed' };
      }

      console.log(`🚀 Swap transaction sent: ${tx.hash}`);

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

      return {
        success: true,
        txHash: tx.hash,
        receipt: receipt,
        amountIn: amountIn,
        amountOut: amountOut,
        gasUsed: receipt?.gasUsed || null,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: error,
      };
    }
  }

  /**
   * Buy tokens using exact ETH input
   * @param {string} tokenAddress - Token to buy
   * @param {number} ethAmount - Amount of ETH to spend
   * @param {number} fee - Pool fee tier (500, 3000, 10000)
   */
  // async buyToken(tokenAddress, ethAmount = 0.00001, fee) {
  //   try {
  //     // parse amount to ether
  //     const amountIn = ethers.parseEther(ethAmount.toString());

  //     // Check ETH balance
  //     const wethBalance = await this.getTokenBalance(this.wethAddress);

  //     // Make sure we have enought eth
  //     if (wethBalance < amountIn) {
  //       throw new Error(
  //         `Insufficient ETH balance. Need ${ethAmount} ETH, have ${ethers.formatEther(
  //           wethBalance
  //         )} ETH`
  //       );
  //     }

  //     // Create the weth contract
  //     const wethContract = new ethers.Contract(this.wethAddress, ERC20_ABI, this.wallet);

  //     // Approve the router to take the amount in
  //     await wethContract.approve(this.routerAddress, ethers.MaxUint256);

  //     // Configure quote parameters
  //     const quoteParams = {
  //       tokenIn: this.wethAddress,
  //       tokenOut: tokenAddress,
  //       amountIn: amountIn,
  //       fee: fee,
  //       sqrtPriceLimitX96: 0,
  //     };

  //     // Get the quote
  //     const quoteResult = await this.quoterContract.quoteExactInputSingle.staticCall(quoteParams);

  //     // Set the amountOut and gasEstimate
  //     const amountOut = quoteResult[0];
  //     const gasEstimate = quoteResult[3];

  //     // Calculate minimum amount out with slippage
  //     const slippageMultiplier = BigInt(Math.floor((1 - this.slippageTolerance) * 10000));
  //     const minAmountOut = (amountOut * slippageMultiplier) / 10000n;
  //     const gasLimit = (gasEstimate * 150n) / 100n;

  //     // Parameters for the swap
  //     const params = {
  //       tokenIn: this.wethAddress,
  //       tokenOut: tokenAddress,
  //       fee: fee,
  //       recipient: this.wallet.address,
  //       amountIn: amountIn,
  //       amountOutMinimum: minAmountOut,
  //       sqrtPriceLimitX96: 0,
  //     };

  //     // Execute swap with value for ETH
  //     let tx;
  //     try {
  //       tx = await this.routerContract.exactInputSingle(params, {
  //         gasLimit: gasLimit,
  //       });
  //     } catch (error) {
  //       console.error('Simulation failed:', error);
  //       return { success: false, error: 'Simulation failed' };
  //     }

  //     console.log(`🚀 Swap transaction sent: ${tx.hash}`);

  //     // Wait for confirmation
  //     let receipt = null;
  //     for (let i = 0; i < 12; i++) {
  //       try {
  //         await new Promise(resolve => setTimeout(resolve, 5000));
  //         receipt = await this.alchemy.core.getTransactionReceipt(tx.hash);
  //         if (receipt) {
  //           if (receipt.status === 1) {
  //             console.log(`✅ Transaction confirmed in block: ${receipt.blockNumber}`);
  //             break;
  //           } else {
  //             console.error(`❌ Transaction failed with status: ${receipt.status}`);
  //             throw new Error(`Transaction reverted. Gas used: ${receipt.gasUsed}`);
  //           }
  //         }
  //       } catch (error) {
  //         if (error.message.includes('Transaction reverted')) {
  //           throw error;
  //         }
  //         console.log(`Attempt ${i + 1}: Receipt not ready yet...`);
  //       }
  //     }

  //     return {
  //       success: true,
  //       txHash: tx.hash,
  //       receipt: receipt,
  //       amountIn: amountIn,
  //       amountOut: amountOut,
  //       gasUsed: receipt?.gasUsed || null,
  //     };
  //   } catch (error) {
  //     return {
  //       success: false,
  //       error: error.message,
  //       details: error,
  //     };
  //   }
  // }
  /**
   * Sell tokens for ETH
   * @param {string} tokenAddress - Token to sell
   * @param {number} fee - Pool fee tier
   */
  /**
   * Sell tokens for ETH
   * @param {string} tokenAddress - Token to sell
   * @param {number} fee - Pool fee tier
   */
  async sellToken(tokenAddress, fee) {
    try {
      // Get the token balance
      const amountIn = await this.getTokenBalance(tokenAddress);

      if (amountIn === 0n) {
        throw new Error(`No ${tokenAddress} tokens to sell`);
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
      const gasEstimate = quoteResult[3];

      // Calculate minimum amount out with slippage
      const slippageMultiplier = BigInt(Math.floor((1 - this.slippageTolerance) * 10000));
      const minAmountOut = (amountOut * slippageMultiplier) / 10000n;
      const gasLimit = (gasEstimate * 150n) / 100n;

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

      // Execute swap
      let tx;
      try {
        tx = await this.routerContract.exactInputSingle(params);
      } catch (error) {
        console.error('Simulation failed:', error);
        return { success: false, error: 'Simulation failed' };
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

      return {
        success: true,
        txHash: tx.hash,
        receipt: receipt,
        amountIn: amountIn,
        amountOut: amountOut,
        gasUsed: receipt?.gasUsed || null,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: error,
      };
    }
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
   * Start target listener (similar to V2 but uses V3 pool events)
   *
   * const tokenConfig {
        tokenAddress,
        poolAddress,
        targetPrice,
        stopLoss,
        feeTier:
      }
   */
  async startTargetListener(tokenConfig) {
    try {
      const { tokenAddress, poolAddress, targetPrice, stopLoss, feeTier } = tokenConfig;

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

          // if (!position) return

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
        tokenConfig,
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
   * Execute sell (used by listeners)
   */
  async executeSell(tokenAddress, reason) {
    try {
      const position = this.positions.get(tokenAddress);
      if (!position) return;

      console.log(`Selling tokens due to: ${reason}`);

      const result = await this.sellToken(tokenAddress, null, {
        feeTier: position.fee,
      });

      // Stop the listener after selling
      await this.stopTargetListener(tokenAddress);

      return result;
    } catch (error) {
      console.error('Auto-sell failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Utility methods
  async getWETHBalance() {
    if (!this.wallet) return 0n;
    const balance = await this.alchemy.core.getBalance(this.wallet.address);
    return balance.toBigInt();
  }

  async getTokenBalance(tokenAddress) {
    if (!this.wallet) return 0n;
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
    return await tokenContract.balanceOf(this.wallet.address);
  }

  async getTokenDecimals(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      return await tokenContract.decimals();
    } catch (error) {
      console.error('Failed to get token decimals:', error);
      return 18;
    }
  }

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

  getActiveListeners() {
    return Array.from(this.listeners.entries()).map(([tokenAddress, info]) => ({
      tokenAddress,
      startTime: info.startTime,
      config: info.tokenConfig,
    }));
  }

  getPositions() {
    return Array.from(this.positions.entries()).map(([tokenAddress, position]) => ({
      tokenAddress,
      ...position,
    }));
  }

  async stopAllListeners() {
    const promises = Array.from(this.listeners.keys()).map(tokenAddress =>
      this.stopTargetListener(tokenAddress)
    );
    await Promise.all(promises);
    console.log('🛑 All listeners stopped');
  }
}

/**
 * For testing - Base network addresses
 */
async function main() {
  const uni = new UniswapV3(
    '8453', // Base
    '0x2626664c2603336E57B271c5C0b26F421741e481', // SwapRouter address on Base
    '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', // Factory address on Base
    '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a' // Quoter address on Base
  );

  await uni.initialize();

  const poolAddress = '0x0FB597D6cFE5bE0d5258A7f017599C2A4Ece34c7';
  const tokenAddress = '0x52b492a33E447Cdb854c7FC19F1e57E8BfA1777D';

  // console.log(await uni.getTargetAndStopLoss(poolAddress));

  const tokenConfig = {
    tokenAddress: '0x52b492a33E447Cdb854c7FC19F1e57E8BfA1777D',
    poolAddress: poolAddress,
    targetPrice: 3.2453924213097525e-11,
    stopLoss: 8.113481053274381e-12,
    feeTier: 10000n, //  1% Fee pool
  };

  console.log(await uni.getPrice(poolAddress));
}

// Uncomment to test
main();
