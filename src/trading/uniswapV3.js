import { ethers } from 'ethers';
import { Alchemy } from 'alchemy-sdk';
import { getWallet } from './getWallet.js';
import { getAlchemySettings } from '../utils/getAlchemySettings.js';

// Uniswap V3 ABIs
const UNISWAP_V3_SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
  'function WETH9() external pure returns (address)',
];

const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
  'function quoteExactOutputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountOut, uint160 sqrtPriceLimitX96) external returns (uint256 amountIn)',
];

const UNISWAP_V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

const UNISWAP_V3_POOL_ABI = [
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
];

const ERC20_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function totalSupply() external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

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
      UNISWAP_V3_SWAP_ROUTER_ABI,
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
      UNISWAP_V3_QUOTER_ABI,
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

  /**
   * Buy tokens using exact ETH input
   * @param {string} tokenAddress - Token to buy
   * @param {number} ethAmount - Amount of ETH to spend
   * @param {number} fee - Pool fee tier (500, 3000, 10000)
   * @param {number} slippageTolerance - Slippage tolerance (0.01 = 1%)
   */
  async buyToken(tokenAddress, ethAmount = 0.00001, fee) {
    try {
      const deadline = Math.floor(Date.now() / 1000) + 120; // 5 minutes
      const amountIn = ethers.parseEther(ethAmount.toString());

      // Check ETH balance
      const ethBalance = await this.getETHBalance();
      console.log(`ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);

      if (ethBalance < amountIn) {
        throw new Error(
          `Insufficient ETH balance. Need ${ethAmount} ETH, have ${ethers.formatEther(
            ethBalance
          )} ETH`
        );
      }

      // Get quote for expected output
      let expectedOut;
      try {
        expectedOut = await this.quoterContract.quoteExactInputSingle.staticCall(
          this.wethAddress,
          tokenAddress,
          fee,
          amountIn,
          0 // No price limit for quote
        );
      } catch (error) {
        console.error('Quote failed:', error);
        throw new Error(
          'Unable to get price quote. Pool may not exist or have insufficient liquidity.'
        );
      }

      // Calculate minimum amount out with slippage
      const slippageMultiplier = BigInt(Math.floor((1 - this.slippageTolerance) * 10000));
      const minAmountOut = (expectedOut * slippageMultiplier) / 10000n;

      const tokenDecimals = await this.getTokenDecimals(tokenAddress);
      console.log(`Expected tokens out: ${ethers.formatUnits(expectedOut, tokenDecimals)}`);
      console.log(`Minimum tokens out: ${ethers.formatUnits(minAmountOut, tokenDecimals)}`);

      // Prepare swap parameters
      const params = {
        tokenIn: this.wethAddress,
        tokenOut: tokenAddress,
        fee: fee,
        recipient: this.wallet.address,
        deadline: deadline,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0, // No price limit
      };

      // Estimate gas
      const gasEstimate = await this.routerContract.exactInputSingle.estimateGas(params, {
        value: amountIn,
      });

      const gasLimit = (gasEstimate * 120n) / 100n; // Add 20% buffer

      // Execute swap
      const tx = await this.routerContract.exactInputSingle(params, {
        value: amountIn,
        gasLimit: gasLimit,
      });

      console.log(`🚀 Swap transaction sent: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(`✅ Swap confirmed in block: ${receipt.blockNumber}`);

      return {
        success: true,
        txHash: tx.hash,
        receipt: receipt,
        amountIn: amountIn,
        amountOut: expectedOut,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      console.error('❌ Buy failed:', error);
      return {
        success: false,
        error: error.message,
        details: error,
      };
    }
  }

  /**
   * Sell tokens for ETH
   * @param {string} tokenAddress - Token to sell
   * @param {string} amount - Amount of tokens to sell (will use balance if not specified)
   * @param {number} fee - Pool fee tier
   * @param {number} slippageTolerance - Slippage tolerance
   */
  async sellToken(tokenAddress, fee) {
    try {
      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

      // Get token info
      const decimals = await this.getTokenDecimals(tokenAddress);
      const tokenBalance = await this.getTokenBalance(tokenAddress);
      const tokenInfo = await this.getTokenInfo(tokenAddress);

      console.log(`📊 Token: ${tokenInfo?.name} (${tokenInfo?.symbol})`);
      console.log(`📊 Balance: ${ethers.formatUnits(tokenBalance, decimals)}`);

      // Determine amount to sell
      let amountIn;
      if (amount) {
        amountIn = ethers.parseUnits(amount.toString(), decimals);
      } else {
        amountIn = tokenBalance; // Sell entire balance
      }

      if (amountIn === 0n) {
        throw new Error('No tokens to sell');
      }

      if (amountIn > tokenBalance) {
        throw new Error('Insufficient token balance');
      }

      console.log(`💰 Selling ${ethers.formatUnits(amountIn, decimals)} ${tokenInfo?.symbol}`);

      // Check and approve token spending
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      const allowance = await tokenContract.allowance(this.wallet.address, this.routerAddress);

      if (allowance < amountIn) {
        console.log('🔓 Approving token spend...');
        const approveTx = await tokenContract.approve(this.routerAddress, ethers.MaxUint256);
        await approveTx.wait();
        console.log('✅ Approval confirmed');
      }

      // Get quote
      let expectedOut;
      try {
        expectedOut = await this.quoterContract.quoteExactInputSingle.staticCall(
          tokenAddress,
          this.wethAddress,
          fee,
          amountIn,
          0
        );
      } catch (error) {
        console.error('Quote failed:', error);
        throw new Error(
          'Unable to get price quote. Pool may not exist or have insufficient liquidity.'
        );
      }

      const slippageMultiplier = BigInt(Math.floor((1 - this.slippageTolerance) * 10000));
      const minAmountOut = (expectedOut * slippageMultiplier) / 10000n;

      console.log(`💡 Expected ETH out: ${ethers.formatEther(expectedOut)}`);
      console.log(`🎯 Minimum ETH out: ${ethers.formatEther(minAmountOut)}`);

      // Prepare swap parameters
      const params = {
        tokenIn: tokenAddress,
        tokenOut: this.wethAddress,
        fee: fee,
        recipient: this.wallet.address,
        deadline: deadline,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0,
      };

      // Execute swap
      const tx = await this.routerContract.exactInputSingle(params);
      console.log(`🚀 Swap transaction sent: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`✅ Swap confirmed in block: ${receipt.blockNumber}`);

      return {
        success: true,
        txHash: tx.hash,
        receipt: receipt,
        amountIn: amountIn,
        amountOut: expectedOut,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      console.error('❌ Sell failed:', error);
      return {
        success: false,
        error: error.message,
        details: error,
      };
    }
  }

  /**
   * Get a quote for a swap without executing it
   * @param {string} tokenIn - Input token address
   * @param {string} tokenOut - Output token address
   * @param {string} amountIn - Input amount
   * @param {number} fee - Pool fee tier
   * @returns {Promise<BigInt>} - Expected output amount
   */
  async getSwapQuote(tokenIn, tokenOut, amountIn, fee) {
    try {
      const quote = await this.quoterContract.quoteExactInputSingle.staticCall(
        tokenIn,
        tokenOut,
        fee,
        amountIn,
        0
      );

      return quote;
    } catch (error) {
      console.error('Quote failed:', error);
      throw error;
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
  async getETHBalance() {
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

  console.log(await uni.buyToken(tokenAddress, 0.00001, 10000n));

  // Test buy
  // await uni.buyToken("0x4B6104755AfB5Da4581B81C552DA3A25608c73B8", 0.000001);

  // Test sell
  // await uni.sellToken("0x4B6104755AfB5Da4581B81C552DA3A25608c73B8");
}

// Uncomment to test
main();
