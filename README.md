![evmSniper banner](/assets/evmSniper_banner.png)

# EVM SNIPER BOT

EVM Sniper bot can be used to snipe tokens on EVM blockchains with any fork of the Uniswap dex but currently only configured for ETH & Base mainnet. On start up listeners subscribe to `PairCreated` or `PoolCreated` events coming from the dexs and sends the data via websocket. The websocket runs 2 GoPlus security audits on the new token and if it passes it the attempts to buy. The current configuration is for the buy to be 0.00001, target price is at a 20% increase, and stop loss is set for a ~20%. When the price target or stop loss are hit it sells 100% of the position.

- #### The Uniswap version 3 uses WETH to buy tokens and the Uniswap version 2 utilizes native eth for buys.

## USAGE

#### PLEASE CREATE A NEW WALLET FOR THIS PROGRAM AND REMOVE FUNDS FROM WALLET WHEN NOT ACTIVLY USING THE PROGRAM.

- You will need a wallet that contains Eth and WEth for any chain listed in `uniswap.json` file
- Go to the `UniswapV2.js` and `UniswapV3.js` files and modify the amount of eth to buy with. Default is 0.00001

### ALCHEMY API Key

This app requires an Alchemy rpc url. You can get a sign up for a free one [here](https://www.alchemy.com/). Once you're signed up you will see a dashboard where you can create a new app. Create a new app and select the Base & Ethereum Mainnet networks. Grab the API Key in the top right corner paste it into the approprate .env variable using the .env.example for reference.

### Cast Wallet Setup

This bot uses the cast wallet to create a signer. Its recommended to install [Foundry](https://book.getfoundry.sh/introduction/installation/) which comes with cast. From there you can setup a wallet with the following commands.

```
cast wallet import <WALLET_NAME_HERE> --interactive
```

This will prompt you to enter a private key and set a password for the wallet. Once this is complete add the name of the wallet and the password to the .env file.

If you wish to clean up the terminal after this run the following commands but NOTE IT WILL DELETE ALL OF YOUR TERMINAL HISTORY. This is recommended anytime you input sensitive information into the terminal.

```
history -c
rm ~/.bash_history
```

### Install dependencies

Install all dependiencies with:

```
npm install
```

### Start Program

After above steps have been taken you can run:

```
npm run start
```

### Adding a DEX

If you want to add another EVM chain open the `uniswap.json` file and add the deployement addresses for the contracts. Next open `known_tokens.json` and add any token address that can be used to create a pool (ex: WETH, USDC, USDT, ect.). This is needed for the `newTokenChecker.js` which uses this list to find out which token (token0 or token1) is the new token from the Pair/PoolCreated event data.

### FUTURE DEVELOPMENTS

- After a buy/sell transaction we should save the the data to a SQLite database for easy indexing in the future.
- Optomize the allowance/approval of the tokens in the buy and sell functions.
- Create an interactive terminal to see current positions and listeners
