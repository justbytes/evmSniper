![evmSniper banner](/assets/evmSniper_banner.png)

# 🤖 EVM Sniper Bot

An automated multi-chain token trading system that monitors Uniswap V2/V3 protocols across Ethereum and Base networks for newly launched tokens. Built with Node.js, ethers.js, alchemy-sdk, and WebSocket architecture for real-time blockchain event processing and intelligent trading execution.

## 🌐 Live Demo
Currently configured for Ethereum and Base mainnet networks

## ⚠️ Security Notice
Create a new wallet for this program and remove funds when not actively using

## ✨ Features

- **Real-time Token Detection**  
 Monitors PairCreated and PoolCreated events across multiple DEXs
- **Automated Security Auditing**  
 Integrated GoPlus API with rugpull detection and token security validation
- **Intelligent Trading Engine**  
 Supports both Uniswap V2 and V3 protocols
- **Custom Trading Algorithm**  
 Automated stop-loss and target price execution capabilities
- **Multi-Chain Support**  
 Ethereum and Base mainnet with extensible configuration
- **Rate-Limited API Integration**  
 Custom rate limiter with queue management and exponential backoff
- **WebSocket Architecture**  
 Real-time event processing with graceful error handling

## 🛠 Tech Stack

### Backend & Infrastructure
- Node.js
- WebSocket Server for event-driven architecture
- Custom rate limiting and queue management

### Blockchain Integration
- ethers.js for smart contract interactions
- Alchemy SDK for blockchain providers
- Uniswap V2/V3 protocol integration
- Cast wallet for secure signing

### APIs & Security
- GoPlus Security API for token auditing
- Custom rate limiter (30 calls/minute)
- Automated security validation pipeline

## 🏗 Architecture

### Multi-Protocol Trading System
This application uses a dual-protocol approach:

**Uniswap V2 Trading**
- Uses native ETH for token purchases
- Monitors PairCreated events from factory contracts
- Implements slippage protection

**Uniswap V3 Trading**
- Uses WETH for token purchases
- Monitors PoolCreated events with fee tier support
- Advanced price calculation using sqrtPriceX96

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Foundry (for Cast wallet)
- Alchemy API key
- ETH and WETH on target networks

### 1. Environment Setup
Create a .env file using the provided .env.example:

```env
ALCHEMY_KEY=your_alchemy_api_key
CAST_WALLET_NAME=your_wallet_name
CAST_WALLET_PASSWORD=your_wallet_password
PORT=8069
```
### 2. Cast Wallet Setup
Create a new wallet using Foundry's Cast:
```bash
cast wallet import <WALLET_NAME_HERE> --interactive
```

Enter your private key and set a password when prompted.

Security cleanup (optional but recommended):
```bash
history -c
rm ~/.bash_history
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure DEX Settings
- Review and modify `uniswap.json` for your target networks and DEX configurations
- Update `known_tokens.json` with base tokens for each network (WETH, USDC, USDT, etc.)

### 5. Customize Trading Parameters
Navigate to `UniswapV2.js` and `UniswapV3.js`:
```javascript
// Modify buy amount (default: 0.00001 ETH)
const ethAmount = 0.00001;
// Adjust risk parameters
const targetMultiplier = 2;    // 200% gain target
const stopLossMultiplier = 0.5; // 50% loss threshold
```

### 6. Start the Application
```bash
npm run start
```

## 🔧 System Management

### Adding New DEX Support
1. Update `uniswap.json` with contract addresses:
```json
{
  "chain": "YourChain",
  "chain_id": "123",
  "dex": "uniswap",
  "v2": {
    "factory": "0x...",
    "router": "0x..."
  },
  "v3": {
    "factory": "0x...",
    "router": "0x...",
    "quoter": "0x..."
  }
}  
```
3. Add base tokens to `known_tokens.json`
4. Update chain utilities in `utils/` directory

### Rate Limiter Management
The system includes advanced rate limiting for GoPlus API calls:

- **Monitor status:** Check console logs for rate limiter statistics
- **Queue management:** Automatic queuing during high-traffic periods
- **Recovery:** Built-in exponential backoff and retry logic

## 🔮 Roadmap

### Planned Features
- **Database Integration**  
  SQLite implementation for trade history and analytics
- **Portfolio Dashboard**  
  Real-time position tracking and P&L analysis
- **Advanced Filtering**  
  Market cap, volume, and liquidity-based token filtering
- **Multi-DEX Support**  
  SushiSwap, PancakeSwap, and other Uniswap forks
- **Enhanced Security**  
  Additional audit providers and custom security checks
- **Terminal Interface**  
  Interactive CLI for position management
