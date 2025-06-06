import { ethers } from "ethers";
import { Alchemy } from "alchemy-sdk";
import { getWallet } from "./getWallet.js";
import { getAlchemySettings } from "../utils/getAlchemySettings.js";

// Uniswap V3 ABIs
const UNISWAP_V3_SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
  "function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)",
  "function WETH9() external pure returns (address)",
];

const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
  "function quoteExactOutputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountOut, uint160 sqrtPriceLimitX96) external returns (uint256 amountIn)",
];

const UNISWAP_V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

const UNISWAP_V3_POOL_ABI = [
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function totalSupply() external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
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
   * Buys a token using native ETH
   */
  async buyToken(tokenAddress, ethAmount = 0.000001, feeTier) {
    try {
      const deadline = Math.floor(Date.now() / 1000) + 120; // 2 min deadline
      const amountIn = ethers.parseEther(ethAmount.toString());

      // Find the best fee tier if not specified
      const fee =
        feeTier || (await this.findBestFeeTier(this.wethAddress, tokenAddress));

      console.log(
        `🔥 Buying ${ethAmount} ETH worth of tokens with ${
          fee / 10000
        }% fee tier...`
      );

      // Check ETH balance
      const ethBalance = await this.getETHBalance();
      console.log(`ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);
      console.log(`Trying to spend: ${ethers.formatEther(amountIn)} ETH`);

      // Get expected output using quoter
      const expectedOut =
        await this.quoterContract.quoteExactInputSingle.staticCall(
          this.wethAddress,
          tokenAddress,
          fee,
          amountIn,
          0 // sqrtPriceLimitX96 (0 = no limit)
        );

      const minAmountOut =
        (expectedOut *
          BigInt(Math.floor((1 - this.slippageTolerance) * 1000))) /
        1000n;

      console.log("Expected Out: ", expectedOut);

      // Prepare swap parameters
      const params = {
        tokenIn: this.wethAddress,
        tokenOut: tokenAddress,
        fee: fee,
        recipient: this.wallet.address,
        deadline: deadline,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0,
      };

      // Estimate gas
      const gasEstimate =
        await this.routerContract.exactInputSingle.estimateGas(params, {
          value: amountIn,
        });

      const gasEstimateBigInt = gasEstimate.toBigInt
        ? gasEstimate.toBigInt()
        : BigInt(gasEstimate);
      const gasLimit = (gasEstimateBigInt * 120n) / 100n;

      // Get gas price
      const gasPrice = await this.alchemy.core.getGasPrice();
      const gasPriceBigInt = gasPrice.toBigInt
        ? gasPrice.toBigInt()
        : BigInt(gasPrice);
      const gasCost = gasLimit * gasPriceBigInt;

      console.log(`Estimated gas: ${gasEstimate.toString()}`);
      console.log(`Gas limit (with buffer): ${gasLimit.toString()}`);
      console.log(`Estimated gas cost: ${ethers.formatEther(gasCost)} ETH`);

      // Check if we have enough ETH
      const totalCost = amountIn + gasCost;
      if (ethBalance < totalCost) {
        throw new Error(
          `Insufficient ETH. Need ${ethers.formatEther(
            totalCost
          )} ETH, have ${ethers.formatEther(ethBalance)} ETH`
        );
      }

      // Execute swap
      const txOptions = {
        value: amountIn,
        gasLimit: gasLimit,
        gasPrice: gasPriceBigInt,
      };

      const tx = await this.routerContract.exactInputSingle(params, txOptions);

      console.log(`Transaction sent: ${tx.hash}`);

      // Wait for receipt (optional, using same pattern as V2)
      let receipt = null;
      for (let i = 0; i < 6; i++) {
        try {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          receipt = await this.alchemy.core.getTransactionReceipt(tx.hash);
          if (receipt && receipt.blockNumber) {
            console.log(
              `Transaction confirmed in block: ${receipt.blockNumber}`
            );
            break;
          }
        } catch (error) {
          console.log(`Attempt ${i + 1}: Receipt not ready yet...`);
        }
      }

      if (!receipt) {
        console.warn(
          "Transaction sent but could not confirm receipt after 6 seconds"
        );
      }

      // Store position info
      this.positions.set(tokenAddress, {
        entryPrice: await this.getPrice(tokenAddress, fee),
        amount: expectedOut,
        entryTime: Date.now(),
        txHash: tx.hash,
        fee: fee,
      });

      return {
        success: true,
        txHash: tx.hash,
        receipt: receipt,
        tokensReceived: expectedOut,
        feeTier: fee,
      };
    } catch (error) {
      console.error("Buy failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sells tokens for ETH
   */
  async sellToken(tokenAddress, tokenAmount, feeTier) {
    try {
      const { feeTier = null } = options;
      const deadline = Math.floor(Date.now() / 1000) + 120;

      // Get token info
      const decimals = await this.getTokenDecimals(tokenAddress);
      const tokenBalance = await this.getTokenBalance(tokenAddress);
      const tokenInfo = await this.getTokenInfo(tokenAddress);

      console.log(`📊 Token Info: ${tokenInfo?.name} (${tokenInfo?.symbol})`);
      console.log(
        `📊 Token Balance: ${ethers.formatUnits(tokenBalance, decimals)}`
      );
      console.log(`📊 Decimals: ${decimals}`);

      // Use full balance
      const amountIn = tokenBalance;

      if (amountIn === 0n) {
        throw new Error("No tokens to sell!");
      }

      console.log(
        `💰 Selling ${ethers.formatUnits(amountIn, decimals)} tokens...`
      );

      // Find the best fee tier if not specified
      const fee =
        feeTier || (await this.findBestFeeTier(tokenAddress, this.wethAddress));

      // Check and approve token spending
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.wallet
      );
      const allowance = await tokenContract.allowance(
        this.wallet.address,
        this.routerAddress
      );

      console.log(
        `🔍 Current allowance: ${ethers.formatUnits(allowance, decimals)}`
      );
      console.log(
        `🔍 Amount to sell: ${ethers.formatUnits(amountIn, decimals)}`
      );

      if (allowance < amountIn) {
        console.log("🔓 Approving token spend...");
        const approveTx = await tokenContract.approve(
          this.routerAddress,
          ethers.MaxUint256
        );
        console.log(`Approval transaction sent: ${approveTx.hash}`);

        // Wait for approval
        console.log("⏳ Waiting for approval to be confirmed...");
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const newAllowance = await tokenContract.allowance(
            this.wallet.address,
            this.routerAddress
          );
          console.log(
            `Checking allowance... ${ethers.formatUnits(
              newAllowance,
              decimals
            )}`
          );
          if (newAllowance >= amountIn) {
            console.log("✅ Approval confirmed!");
            break;
          }
        }
      }

      // Get expected output using quoter
      console.log("🔍 Getting quote...");
      const expectedOut =
        await this.quoterContract.quoteExactInputSingle.staticCall(
          tokenAddress,
          this.wethAddress,
          fee,
          amountIn,
          0
        );

      console.log(`✅ Expected output: ${ethers.formatEther(expectedOut)} ETH`);

      const minAmountOut =
        (expectedOut *
          BigInt(Math.floor((1 - this.slippageTolerance) * 1000))) /
        1000n;
      console.log(`🎯 Min amount out: ${ethers.formatEther(minAmountOut)} ETH`);

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

      // Estimate gas
      console.log("🔍 Testing gas estimation...");
      const gasEstimate =
        await this.routerContract.exactInputSingle.estimateGas(params);

      console.log(`✅ Gas estimate successful: ${gasEstimate.toString()}`);

      const gasEstimateBigInt = gasEstimate.toBigInt
        ? gasEstimate.toBigInt()
        : BigInt(gasEstimate);
      const gasLimit = (gasEstimateBigInt * 120n) / 100n;

      const gasPrice = await this.alchemy.core.getGasPrice();
      const gasPriceBigInt = gasPrice.toBigInt
        ? gasPrice.toBigInt()
        : BigInt(gasPrice);

      const txOptions = {
        gasLimit: gasLimit,
        gasPrice: gasPriceBigInt,
      };

      const tx = await this.routerContract.exactInputSingle(params, txOptions);

      console.log(`🚀 Transaction sent: ${tx.hash}`);

      // Update position info
      if (this.positions.has(tokenAddress)) {
        const position = this.positions.get(tokenAddress);
        position.exitPrice = await this.getPrice(tokenAddress, fee);
        position.exitTime = Date.now();
        position.sellTxHash = tx.hash;
      }

      return {
        success: true,
        txHash: tx.hash,
        ethReceived: expectedOut,
        feeTier: fee,
      };
    } catch (error) {
      console.error("Sell failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get token price in ETH using quoter
   */
  async getPrice(poolAddress) {
    try {
      const poolContract = new ethers.Contract(
        this.dodoEgg.pairAddress,
        IUniswapV3PoolABI,
        await this.wallet
      );

      const price = await poolContract.slot0();

      return price[0];
    } catch (error) {
      console.error("There was a problem getting v3 price!\n", error);
      return false;
    }
  }

  /**
   * Get pool address for token pair and fee
   */
  async getPoolAddress(tokenA, tokenB, fee) {
    try {
      const poolAddress = await this.factoryContract.getPool(
        tokenA,
        tokenB,
        fee
      );
      if (poolAddress === ethers.ZeroAddress) {
        throw new Error("Pool does not exist");
      }
      return poolAddress;
    } catch (error) {
      console.error("Failed to get pool address:", error);
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
      const { tokenAddress, poolAddress, targetPrice, stopLoss, feeTier } =
        tokenConfig;

      // Create filter for Swap events
      const filter = {
        address: poolAddress,
        topics: [this.poolInterface.getEvent("Swap").topicHash],
      };

      const listener = async () => {
        try {
          console.log("🔄 Swap event detected");

          const currentPrice = await this.getPrice(poolAddress);
          const position = this.positions.get(tokenAddress);

          // if (!position) return

          console.log(`Current price: $${currentPrice}`);
          console.log(`Target: $${targetPrice}, Stop Loss: $${stopLoss}`);

          // Check target price
          if (targetPrice && currentPrice >= targetPrice) {
            console.log("🚀 Target price reached! Executing sell...");
            await this.executeSell(tokenAddress, "TARGET_HIT");
          }

          // Check stop loss
          if (stopLoss && currentPrice <= stopLoss) {
            console.log("🛑 Stop loss triggered! Executing sell...");
            await this.executeSell(tokenAddress, "STOP_LOSS");
          }
        } catch (error) {
          console.error("Error in swap listener:", error);
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
      console.error("Failed to start listener:", error);
      return false;
    }
  }

  /**
   * Stop target listener
   */
  async stopTargetListener(tokenAddress) {
    const listenerInfo = this.listeners.get(tokenAddress);
    if (!listenerInfo) {
      console.log("No listener found for token");
      return false;
    }

    try {
      this.alchemy.ws.off(listenerInfo.filter, listenerInfo.listener);
      this.listeners.delete(tokenAddress);
      console.log(`🔇 Stopped listening for ${tokenAddress}`);
      return true;
    } catch (error) {
      console.error("Failed to stop listener:", error);
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
      console.error("Auto-sell failed:", error);
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
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ERC20_ABI,
      this.wallet
    );
    return await tokenContract.balanceOf(this.wallet.address);
  }

  async getTokenDecimals(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.wallet
      );
      return await tokenContract.decimals();
    } catch (error) {
      console.error("Failed to get token decimals:", error);
      return 18;
    }
  }

  async getTokenInfo(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.wallet
      );
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        tokenContract.name(),
        tokenContract.symbol(),
        tokenContract.decimals(),
        tokenContract.totalSupply(),
      ]);

      return { name, symbol, decimals, totalSupply };
    } catch (error) {
      console.error("Failed to get token info:", error);
      return null;
    }
  }

  async getMarketCap(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.wallet
      );
      const totalSupply = await tokenContract.totalSupply();
      const decimals = await this.getTokenDecimals(tokenAddress);
      const price = await this.getPrice(tokenAddress);

      const supply = parseFloat(ethers.formatUnits(totalSupply, decimals));
      return supply * price;
    } catch (error) {
      console.error("Failed to get market cap:", error);
      return 0;
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
    return Array.from(this.positions.entries()).map(
      ([tokenAddress, position]) => ({
        tokenAddress,
        ...position,
      })
    );
  }

  async stopAllListeners() {
    const promises = Array.from(this.listeners.keys()).map((tokenAddress) =>
      this.stopTargetListener(tokenAddress)
    );
    await Promise.all(promises);
    console.log("🛑 All listeners stopped");
  }
}

/**
 * For testing - Base network addresses
 */
async function main() {
  const uni = new UniswapV3(
    "8453", // Base
    "0x2626664c2603336E57B271c5C0b26F421741e481", // SwapRouter address on Base
    "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", // Factory address on Base
    "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" // Quoter address on Base
  );

  await uni.initialize();

  console.log(
    await uni.getPrice("0x52b492a33E447Cdb854c7FC19F1e57E8BfA1777D", 10000n)
  );

  // const tokenConfig = {
  //   tokenAddress: "0x52b492a33E447Cdb854c7FC19F1e57E8BfA1777D"
  //   targetPrice:
  //   stopLoss,
  //   feeTier: 10000n, //  1% Fee pool
  // };

  // Test buy
  // await uni.buyToken("0x4B6104755AfB5Da4581B81C552DA3A25608c73B8", 0.000001);

  // Test sell
  // await uni.sellToken("0x4B6104755AfB5Da4581B81C552DA3A25608c73B8");
}

// Uncomment to test
main();
