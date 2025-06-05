import { ethers } from 'ethers';
import { Alchemy } from 'alchemy-sdk';
import { getWallet } from './getWallet.js';
import { getAlchemySettings } from '../utils/getAlchemySettings.js';

// You'll need to import these ABIs - make sure you have the correct imports
const UNISWAP_V2_ROUTER_ABI = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function WETH() external pure returns (address)',
];

const UNISWAP_V2_PAIR_ABI = [
  'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const UNISWAP_V2_FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
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
 *
 */
export class UniswapV2 {
  chainId;
  wallet;
  provider;
  wethAddress;
  routerAddress;
  factoryAddress;
  routerContract; // FIXED: Changed from routerContact
  factoryContract;

  /**
   * Constructor
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
    // this.gasLimit = 500000;
    // this.maxGasPrice = ethers.parseUnits('50', 'gwei');
  }

  /**
   * Creates the contracts, weth address, and wallet
   */
  async initialize() {
    // Create a wallet instance
    this.wallet = await getWallet(this.chainId);

    this.provider = new Alchemy(getAlchemySettings(String(this.chainId)));

    // Router contract
    this.routerContract = new ethers.Contract( // FIXED: Changed from routerContact
      this.routerAddress,
      UNISWAP_V2_ROUTER_ABI,
      this.wallet
    );

    // Factory contract
    this.factoryContract = new ethers.Contract(
      this.factoryAddress,
      UNISWAP_V2_FACTORY_ABI,
      this.provider
    );

    // Get WETH address based off of router
    this.wethAddress = await this.routerContract.WETH(); // FIXED: Changed from routerContact
  }

  /**
   * Gets optimal gas pricing from Alchemy
   */
  async getOptimalGasPrice() {
    try {
      // Get both base fee and priority fee from Alchemy
      const [gasPrice, maxPriorityFeePerGas] = await Promise.all([
        this.provider.getGasPrice(), // Gets current gas price
        this.provider.send('eth_maxPriorityFeePerGas', []), // Alchemy's method
      ]);

      // For EIP-1559 networks, calculate maxFeePerGas
      const maxPriorityFee = BigInt(maxPriorityFeePerGas);
      const baseGasPrice = gasPrice;

      // Add some buffer to ensure transaction goes through
      const maxFeePerGas = baseGasPrice + maxPriorityFee * 2n; // 2x priority fee buffer

      console.log(`Base gas price: ${ethers.formatUnits(baseGasPrice, 'gwei')} gwei`);
      console.log(`Max priority fee: ${ethers.formatUnits(maxPriorityFee, 'gwei')} gwei`);
      console.log(`Max fee per gas: ${ethers.formatUnits(maxFeePerGas, 'gwei')} gwei`);

      return {
        gasPrice: baseGasPrice,
        maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFee,
      };
    } catch (error) {
      console.warn('Failed to get optimal gas price, falling back to provider gas price:', error);
      const gasPrice = await this.provider.getGasPrice();
      return { gasPrice };
    }
  }

  /**
   * Buys a token using native ETH
   */
  async buyToken(tokenAddress, ethAmount = 0.000001) {
    try {
      // Parameters
      const deadline = Math.floor(Date.now() / 1000) + 120; // 2 min deadline
      const path = [this.wethAddress, tokenAddress]; // WETH to token path
      const amountIn = ethers.parseEther(ethAmount.toString()); // Amount of ETH to spend

      // Check ETH balance first
      const ethBalance = await this.provider.core.getBalance(this.wallet.address);
      console.log(ethBalance);

      console.log(`ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);
      console.log(`Trying to spend: ${ethers.formatEther(amountIn)} ETH`);

      // Get expected output
      const amountsOut = await this.routerContract.getAmountsOut(amountIn, path);
      const expectedOut = amountsOut[1];
      const minAmountOut =
        (expectedOut * BigInt(Math.floor((1 - this.slippageTolerance) * 1000))) / 1000n;

      console.log(`🔥 Buying ${ethAmount} ETH worth of tokens...`);
      console.log('ExpectedOut: ', expectedOut);

      // Get optimal gas pricing from Alchemy
      const gasInfo = await this.getOptimalGasPrice();

      // Estimate gas for the transaction
      const gasEstimate = await this.routerContract.swapExactETHForTokens.estimateGas(
        minAmountOut,
        path,
        this.wallet.address,
        deadline,
        { value: amountIn }
      );

      // Add 20% buffer to gas estimate
      const gasLimit = (gasEstimate * 120n) / 100n;

      // Calculate total gas cost
      const gasCost = gasLimit * (gasInfo.maxFeePerGas || gasInfo.gasPrice);

      console.log(`Estimated gas: ${gasEstimate.toString()}`);
      console.log(`Gas limit (with buffer): ${gasLimit.toString()}`);
      console.log(`Estimated gas cost: ${ethers.formatEther(gasCost)} ETH`);

      // Check if we have enough ETH for swap + gas
      const totalCost = amountIn + gasCost;
      if (ethBalance < totalCost) {
        throw new Error(
          `Insufficient ETH. Need ${ethers.formatEther(totalCost)} ETH, have ${ethers.formatEther(
            ethBalance
          )} ETH`
        );
      }

      // Prepare transaction options with dynamic gas
      let txOptions = {
        value: amountIn,
        gasLimit: gasLimit,
      };

      // Use EIP-1559 gas pricing if available, otherwise legacy
      if (gasInfo.maxFeePerGas && gasInfo.maxPriorityFeePerGas) {
        txOptions.maxFeePerGas = gasInfo.maxFeePerGas;
        txOptions.maxPriorityFeePerGas = gasInfo.maxPriorityFeePerGas;
        console.log('Using EIP-1559 gas pricing');
      } else {
        txOptions.gasPrice = gasInfo.gasPrice;
        console.log('Using legacy gas pricing');
      }

      const tx = await this.routerContract.swapExactETHForTokens(
        minAmountOut,
        path,
        this.wallet.address,
        deadline,
        txOptions
      );

      console.log(`Transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block: ${receipt.blockNumber}`);

      // Store position info
      this.positions.set(tokenAddress, {
        entryPrice: await this.getPrice(tokenAddress),
        amount: expectedOut,
        entryTime: Date.now(),
        txHash: tx.hash,
      });

      return {
        success: true,
        txHash: tx.hash,
        receipt: receipt,
        tokensReceived: expectedOut,
      };
    } catch (error) {
      console.error('Buy failed:', error);
      return { success: false, error: error.message };
    }
  }

  async sellToken(tokenAddress, tokenAmount, options = {}) {
    try {
      const {
        slippage = this.slippageTolerance,
        gasPrice,
        gasLimit = this.gasLimit,
        deadline = Math.floor(Date.now() / 1000) + 1200,
      } = options;

      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      const decimals = await this.getTokenDecimals(tokenAddress);
      const amountIn = ethers.parseUnits(tokenAmount.toString(), decimals);

      // Check and approve if necessary
      const allowance = await tokenContract.allowance(this.wallet.address, this.routerAddress); // FIXED
      if (allowance < amountIn) {
        console.log('Approving token spend...');
        const approveTx = await tokenContract.approve(this.routerAddress, ethers.MaxUint256); // FIXED
        await approveTx.wait();
      }

      const path = [tokenAddress, this.wethAddress];
      const amountsOut = await this.routerContract.getAmountsOut(amountIn, path); // FIXED
      const expectedOut = amountsOut[1];
      const minAmountOut = (expectedOut * BigInt(Math.floor((1 - slippage) * 1000))) / 1000n;

      console.log(`💰 Selling ${tokenAmount} tokens...`);
      console.log(`Expected ETH: ${ethers.formatEther(expectedOut)}`);

      const txOptions = { gasLimit };
      if (gasPrice) txOptions.gasPrice = gasPrice;

      const tx = await this.routerContract.swapExactTokensForETH(
        // FIXED
        amountIn,
        minAmountOut,
        path,
        this.wallet.address,
        deadline,
        txOptions
      );

      const receipt = await tx.wait();

      // Update position info
      if (this.positions.has(tokenAddress)) {
        const position = this.positions.get(tokenAddress);
        position.exitPrice = await this.getPrice(tokenAddress);
        position.exitTime = Date.now();
        position.sellTxHash = tx.hash;
      }

      return {
        success: true,
        txHash: tx.hash,
        receipt: receipt,
        ethReceived: expectedOut,
      };
    } catch (error) {
      console.error('Sell failed:', error);
      return { success: false, error: error.message };
    }
  }

  async startTargetListener(tokenConfig) {
    try {
      const { tokenAddress, targetPrice, stopLoss, pairAddress } = tokenConfig;

      if (!pairAddress) {
        tokenConfig.pairAddress = await this.getPairAddress(tokenAddress, this.wethAddress);
      }

      // Create filter for Swap events
      const filter = {
        address: tokenConfig.pairAddress,
        topics: [this.pairInterface.getEvent('Swap').topicHash],
      };

      const listener = async log => {
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
      this.provider.on(filter, listener);

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

  async stopTargetListener(tokenAddress) {
    const listenerInfo = this.listeners.get(tokenAddress);
    if (!listenerInfo) {
      console.log('No listener found for token');
      return false;
    }

    try {
      this.provider.off(listenerInfo.filter, listenerInfo.listener);
      this.listeners.delete(tokenAddress);
      console.log(`🔇 Stopped listening for ${tokenAddress}`);
      return true;
    } catch (error) {
      console.error('Failed to stop listener:', error);
      return false;
    }
  }

  async getPrice(tokenAddress) {
    try {
      const path = [tokenAddress, this.wethAddress];
      const tokenDecimals = await this.getTokenDecimals(tokenAddress);
      const oneToken = ethers.parseUnits('1', tokenDecimals);

      const amountsOut = await this.routerContract.getAmountsOut(oneToken, path); // FIXED
      const priceInWeth = amountsOut[1];

      // Convert to USD (you'd need to get ETH price from an oracle or API)
      // For now, returning price in ETH
      return parseFloat(ethers.formatEther(priceInWeth));
    } catch (error) {
      console.error('Failed to get price:', error);
      return 0;
    }
  }

  async getMarketCap(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
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

  async getAmountOut(amountIn, tokenIn, tokenOut) {
    try {
      const path = [tokenIn, tokenOut];
      const amountsOut = await this.routerContract.getAmountsOut(amountIn, path); // FIXED
      return amountsOut[1];
    } catch (error) {
      console.error('Failed to get amount out:', error);
      return 0n;
    }
  }

  async getTargetAndStopLoss(tokenAddress, targetMultiplier = 2, stopLossMultiplier = 0.5) {
    const currentPrice = await this.getPrice(tokenAddress);
    return {
      currentPrice,
      targetPrice: currentPrice * targetMultiplier,
      stopLoss: currentPrice * stopLossMultiplier,
    };
  }

  async getTokenDecimals(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      return await tokenContract.decimals();
    } catch (error) {
      console.error('Failed to get token decimals:', error);
      return 18; // Default to 18
    }
  }

  async getTokenInfo(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
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

  async getPairAddress(tokenA, tokenB) {
    try {
      const pairAddress = await this.factoryContract.getPair(tokenA, tokenB); // FIXED
      if (pairAddress === ethers.ZeroAddress) {
        throw new Error('Pair does not exist');
      }
      return pairAddress;
    } catch (error) {
      console.error('Failed to get pair address:', error);
      return null;
    }
  }

  async executeSell(tokenAddress, reason) {
    try {
      const position = this.positions.get(tokenAddress);
      if (!position) return;

      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      const balance = await tokenContract.balanceOf(this.wallet.address);
      const decimals = await this.getTokenDecimals(tokenAddress);
      const amount = ethers.formatUnits(balance, decimals);

      console.log(`Selling ${amount} tokens due to: ${reason}`);

      const result = await this.sellToken(tokenAddress, amount, {
        gasPrice: this.maxGasPrice, // Use higher gas for quick execution
      });

      // Stop the listener after selling
      await this.stopTargetListener(tokenAddress);

      return result;
    } catch (error) {
      console.error('Auto-sell failed:', error);
      return { success: false, error: error.message };
    }
  }

  decodeSwapLog(log) {
    try {
      const decodedLog = this.pairInterface.parseLog(log);
      const { sender, amount0In, amount1In, amount0Out, amount1Out, to } = decodedLog.args;

      return {
        sender,
        amount0In: amount0In.toString(),
        amount1In: amount1In.toString(),
        amount0Out: amount0Out.toString(),
        amount1Out: amount1Out.toString(),
        to,
      };
    } catch (error) {
      console.error('Failed to decode swap log:', error);
      return null;
    }
  }

  // Utility methods
  async getETHBalance() {
    if (!this.wallet) return 0n;
    return await this.provider.getBalance(this.wallet.address);
  }

  async getTokenBalance(tokenAddress) {
    if (!this.wallet) return 0n;
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    return await tokenContract.balanceOf(this.wallet.address);
  }

  // Get all active listeners
  getActiveListeners() {
    return Array.from(this.listeners.entries()).map(([tokenAddress, info]) => ({
      tokenAddress,
      startTime: info.startTime,
      config: info.tokenConfig,
    }));
  }

  // Get all positions
  getPositions() {
    return Array.from(this.positions.entries()).map(([tokenAddress, position]) => ({
      tokenAddress,
      ...position,
    }));
  }

  // Emergency stop all listeners
  async stopAllListeners() {
    const promises = Array.from(this.listeners.keys()).map(tokenAddress =>
      this.stopTargetListener(tokenAddress)
    );
    await Promise.all(promises);
    console.log('🛑 All listeners stopped');
  }
}

async function main() {
  const uni = new UniswapV2(
    '8453',
    '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
    '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6'
  );

  await uni.initialize();

  await uni.buyToken('0x4B6104755AfB5Da4581B81C552DA3A25608c73B8');
}
main();
